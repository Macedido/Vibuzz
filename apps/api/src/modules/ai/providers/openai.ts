import { ProviderError } from '../../../lib/errors';
import { readSse } from '../../../lib/sse';
import type { ChatProvider, ChatRequest, ContentPart, EmbedResult, ModerationResult, StreamChunk } from '../types';
import { isRetryable } from './anthropic';

export interface OpenAICompatibleOptions {
  /** api.openai.com (uses max_completion_tokens, reasoning_effort, moderation). */
  official?: boolean;
  /** Path of the chat endpoint relative to baseUrl. */
  chatPath?: string;
  /** Give up (and fall back to the next model) if no response headers arrive in time. */
  firstByteTimeoutMs?: number;
}

/**
 * OpenAI and any OpenAI-compatible API (Gemini, OVHcloud, Pollinations, Groq,
 * OpenRouter, vLLM...). Works with or without an API key. Unsupported params
 * are dropped and remembered per model.
 */
export class OpenAICompatibleProvider implements ChatProvider {
  private unsupported = new Map<string, Set<string>>();

  constructor(
    readonly name: string,
    private apiKey: string,
    private baseUrl: string,
    private opts: OpenAICompatibleOptions = {},
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private headers(): Record<string, string> {
    return this.apiKey ? { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` } : { 'content-type': 'application/json' };
  }

  /** Aborts when the caller aborts or when the first response takes too long. */
  private async send(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => ctrl.abort(), this.opts.firstByteTimeoutMs ?? 60_000);
    try {
      return await this.fetchImpl(url, { ...init, signal: ctrl.signal });
    } catch (e) {
      const callerAborted = signal?.aborted ?? false;
      throw new ProviderError(this.name, null, callerAborted ? 'aborted' : (e as Error).message || 'timeout', !callerAborted);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  private body(model: string, req: ChatRequest, skip: Set<string>) {
    const system = [req.system.stable, req.system.dynamic, req.json ? 'Respond with a single valid JSON object only.' : '']
      .filter(Boolean)
      .join('\n\n');
    const messages = [
      { role: 'system', content: system },
      ...req.messages.map((m) => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : m.content.map(toPart),
      })),
    ];
    const body: Record<string, unknown> = { model, messages, stream: true, stream_options: { include_usage: true } };
    body[this.opts.official ? 'max_completion_tokens' : 'max_tokens'] = req.maxTokens;
    if (skip.has('stream_options')) delete body.stream_options;
    if (req.temperature != null && !skip.has('temperature')) body.temperature = req.temperature;
    if (req.json && !skip.has('response_format')) body.response_format = { type: 'json_object' };
    if (req.effort && this.opts.official && !skip.has('reasoning_effort')) body.reasoning_effort = req.effort;
    return body;
  }

  async *stream(model: string, req: ChatRequest): AsyncGenerator<StreamChunk> {
    const skip = this.unsupported.get(model) ?? new Set<string>();
    let res: Response | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      res = await this.send(
        `${this.baseUrl}${this.opts.chatPath ?? '/chat/completions'}`,
        { method: 'POST', headers: this.headers(), body: JSON.stringify(this.body(model, req, skip)) },
        req.signal,
      );
      if (res.status === 400) {
        const text = await res.text();
        const param = ['temperature', 'response_format', 'reasoning_effort', 'stream_options'].find((p) => text.includes(p));
        if (param && !skip.has(param)) {
          skip.add(param);
          this.unsupported.set(model, skip);
          continue;
        }
        throw new ProviderError(this.name, 400, text.slice(0, 500), false);
      }
      break;
    }
    if (!res || !res.ok || !res.body) {
      const status = res?.status ?? null;
      const text = res ? await res.text().catch(() => '') : '';
      throw new ProviderError(this.name, status, text.slice(0, 500) || 'request failed', isRetryable(status));
    }

    let inputTokens = 0;
    let outputTokens = 0;
    let stopReason: string | null = null;
    const think = new ThinkFilter();
    for await (const rec of readSse(res.body, req.signal)) {
      if (rec.data === '[DONE]') break;
      let evt: any;
      try {
        evt = JSON.parse(rec.data);
      } catch {
        continue;
      }
      if (evt.error) throw new ProviderError(this.name, null, evt.error.message ?? 'stream error', true);
      const choice = evt.choices?.[0];
      const text = choice?.delta?.content ?? choice?.message?.content;
      const visible = typeof text === 'string' ? think.push(text) : '';
      if (visible) yield { type: 'text', text: visible };
      if (choice?.finish_reason) stopReason = choice.finish_reason;
      if (evt.usage) {
        inputTokens = evt.usage.prompt_tokens ?? inputTokens;
        outputTokens = evt.usage.completion_tokens ?? outputTokens;
      }
    }
    yield { type: 'end', stopReason, inputTokens, outputTokens };
  }

  async embed(model: string, input: string[], dimensions: number): Promise<EmbedResult> {
    const res = await this.fetchImpl(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ model, input, dimensions, encoding_format: 'float' }),
    }).catch((e: Error) => {
      throw new ProviderError(this.name, null, e.message, true);
    });
    if (!res.ok) throw new ProviderError(this.name, res.status, (await res.text()).slice(0, 500), isRetryable(res.status));
    const json: any = await res.json();
    const vectors = (json.data as { index: number; embedding: number[] }[])
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
    if (vectors.some((v) => v.length !== dimensions)) {
      throw new ProviderError(this.name, null, `embedding model returned ${vectors[0]?.length} dims, expected ${dimensions}`, false);
    }
    return { vectors, inputTokens: json.usage?.prompt_tokens ?? 0 };
  }

  async moderate(input: { text?: string; imageBase64?: { data: string; mimeType: string } }): Promise<ModerationResult> {
    const parts: unknown[] = [];
    if (input.text) parts.push({ type: 'text', text: input.text.slice(0, 20000) });
    if (input.imageBase64) {
      parts.push({ type: 'image_url', image_url: { url: `data:${input.imageBase64.mimeType};base64,${input.imageBase64.data}` } });
    }
    const res = await this.fetchImpl(`${this.baseUrl}/moderations`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ model: 'omni-moderation-latest', input: parts }),
    });
    if (!res.ok) throw new ProviderError(this.name, res.status, (await res.text()).slice(0, 500), isRetryable(res.status));
    const json: any = await res.json();
    const r = json.results?.[0] ?? {};
    const categories = Object.entries(r.categories ?? {})
      .filter(([, v]) => v === true)
      .map(([k]) => k);
    return { flagged: Boolean(r.flagged), categories, scores: r.category_scores ?? {} };
  }
}

function toPart(p: ContentPart) {
  if (p.type === 'text') return { type: 'text', text: p.text };
  return { type: 'image_url', image_url: { url: `data:${p.mimeType};base64,${p.base64}` } };
}

/**
 * Removes <think>…</think> blocks that some open models put in the visible
 * text stream. Stateful so tags split across chunks are handled.
 */
export class ThinkFilter {
  private inside = false;
  private carry = '';

  push(chunk: string): string {
    let text = this.carry + chunk;
    this.carry = '';
    let out = '';
    for (;;) {
      if (this.inside) {
        const end = text.indexOf('</think>');
        if (end === -1) {
          this.carry = text.slice(-8);
          return out;
        }
        text = text.slice(end + 8);
        this.inside = false;
      } else {
        const start = text.indexOf('<think>');
        if (start === -1) {
          // Keep a possible partial "<think" for the next chunk.
          const partial = text.lastIndexOf('<');
          if (partial !== -1 && '<think>'.startsWith(text.slice(partial))) {
            this.carry = text.slice(partial);
            return out + text.slice(0, partial);
          }
          return out + text;
        }
        out += text.slice(0, start);
        text = text.slice(start + 7);
        this.inside = true;
      }
    }
  }
}
