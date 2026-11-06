import { ProviderError } from '../../../lib/errors';
import { readSse } from '../../../lib/sse';
import type { ChatProvider, ChatRequest, ContentPart, EmbedResult, ModerationResult, StreamChunk } from '../types';
import { isRetryable } from './anthropic';

/**
 * OpenAI and any OpenAI-compatible API (OpenRouter, Groq, Together, Gemini's
 * compatibility endpoint, vLLM...). Unsupported params are dropped and remembered.
 */
export class OpenAICompatibleProvider implements ChatProvider {
  private unsupported = new Map<string, Set<string>>();

  constructor(
    readonly name: string,
    private apiKey: string,
    private baseUrl: string,
    private opts: { official: boolean } = { official: false },
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private headers() {
    return { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` };
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
    if (req.temperature != null && !skip.has('temperature')) body.temperature = req.temperature;
    if (req.json && !skip.has('response_format')) body.response_format = { type: 'json_object' };
    if (req.effort && this.opts.official && !skip.has('reasoning_effort')) body.reasoning_effort = req.effort;
    return body;
  }

  async *stream(model: string, req: ChatRequest): AsyncGenerator<StreamChunk> {
    const skip = this.unsupported.get(model) ?? new Set<string>();
    let res: Response | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(this.body(model, req, skip)),
        signal: req.signal,
      }).catch((e: Error) => {
        throw new ProviderError(this.name, null, e.message, e.name !== 'AbortError');
      });
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
      const text = choice?.delta?.content;
      if (text) yield { type: 'text', text };
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
