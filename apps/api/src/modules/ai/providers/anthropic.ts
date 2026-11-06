import { ProviderError } from '../../../lib/errors';
import { readSse } from '../../../lib/sse';
import type { ChatProvider, ChatRequest, ContentPart, StreamChunk } from '../types';

/**
 * Anthropic Messages API (streaming). Uses prompt caching on the stable part of
 * the system prompt. Sampling/effort params are dropped automatically for models
 * that reject them, and that choice is remembered per model.
 */
export class AnthropicProvider implements ChatProvider {
  readonly name = 'anthropic';
  private unsupported = new Map<string, Set<'temperature' | 'effort'>>();

  constructor(
    private apiKey: string,
    private baseUrl = 'https://api.anthropic.com',
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private body(model: string, req: ChatRequest, skip: Set<string>) {
    const system: { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }[] = [
      { type: 'text', text: req.system.stable, cache_control: { type: 'ephemeral' } },
    ];
    if (req.system.dynamic) system.push({ type: 'text', text: req.system.dynamic });
    const messages = req.messages.map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : m.content.map(toBlock),
    }));
    if (req.json) {
      system.push({ type: 'text', text: 'Respond with a single valid JSON object only. No prose, no code fences.' });
    }
    const body: Record<string, unknown> = { model, max_tokens: req.maxTokens, system, messages, stream: true };
    if (req.temperature != null && !skip.has('temperature')) body.temperature = req.temperature;
    if (req.effort && !skip.has('effort')) body.output_config = { effort: req.effort };
    return body;
  }

  async *stream(model: string, req: ChatRequest): AsyncGenerator<StreamChunk> {
    const skip = this.unsupported.get(model) ?? new Set();
    let res: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await this.fetchImpl(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(this.body(model, req, skip)),
        signal: req.signal,
      }).catch((e: Error) => {
        throw new ProviderError(this.name, null, e.message, e.name !== 'AbortError');
      });
      if (res.status === 400) {
        const text = await res.text();
        const param = /temperature/i.test(text) ? 'temperature' : /effort|output_config/i.test(text) ? 'effort' : null;
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
    let cacheReadTokens = 0;
    let stopReason: string | null = null;
    for await (const rec of readSse(res.body, req.signal)) {
      let evt: any;
      try {
        evt = JSON.parse(rec.data);
      } catch {
        continue;
      }
      switch (evt.type) {
        case 'message_start': {
          const u = evt.message?.usage ?? {};
          inputTokens = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
          cacheReadTokens = u.cache_read_input_tokens ?? 0;
          outputTokens = u.output_tokens ?? 0;
          break;
        }
        case 'content_block_delta':
          // Only visible text; thinking/signature deltas are internal.
          if (evt.delta?.type === 'text_delta' && evt.delta.text) yield { type: 'text', text: evt.delta.text };
          break;
        case 'message_delta':
          if (evt.usage?.output_tokens != null) outputTokens = evt.usage.output_tokens;
          if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason;
          break;
        case 'error':
          throw new ProviderError(this.name, null, evt.error?.message ?? 'stream error', evt.error?.type === 'overloaded_error');
      }
    }
    yield { type: 'end', stopReason, inputTokens, outputTokens, cacheReadTokens };
  }
}

function toBlock(p: ContentPart) {
  if (p.type === 'text') return { type: 'text', text: p.text };
  return { type: 'image', source: { type: 'base64', media_type: p.mimeType, data: p.base64 } };
}

export function isRetryable(status: number | null): boolean {
  return status == null || status === 408 || status === 409 || status === 429 || status >= 500;
}
