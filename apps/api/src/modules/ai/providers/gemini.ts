import { ProviderError } from '../../../lib/errors';
import { readSse } from '../../../lib/sse';
import type { ChatProvider, ChatRequest, ContentPart, StreamChunk } from '../types';
import { isRetryable } from './anthropic';

/** Google AI Studio keys ("AIza…") use the Gemini API; Vertex AI express keys ("AQ.…") use Vertex. */
export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
export const VERTEX_EXPRESS_BASE = 'https://aiplatform.googleapis.com/v1/publishers/google/models';

/** Model ids are the same on both, but only the Gemini API has the "-latest" aliases. */
const VERTEX_MODEL: Record<string, string> = {
  'gemini-flash-latest': 'gemini-2.5-flash',
  'gemini-flash-lite-latest': 'gemini-2.5-flash-lite',
  'gemini-pro-latest': 'gemini-2.5-pro',
};

export function geminiBasesFor(key: string, override?: string): string[] {
  if (override) return [override.replace(/\/$/, '')];
  return key.startsWith('AQ.') ? [VERTEX_EXPRESS_BASE, GEMINI_API_BASE] : [GEMINI_API_BASE, VERTEX_EXPRESS_BASE];
}

const SAFETY = ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT'].map(
  (category) => ({ category, threshold: 'BLOCK_ONLY_HIGH' }),
);

function toParts(content: string | ContentPart[]) {
  if (typeof content === 'string') return [{ text: content }];
  return content.map((p) => (p.type === 'text' ? { text: p.text } : { inlineData: { mimeType: p.mimeType, data: p.base64 } }));
}

/**
 * Native Gemini streaming (streamGenerateContent + SSE). One key can belong to the
 * Gemini API or to Vertex AI express mode; the first base that accepts it is remembered.
 */
export class GeminiProvider implements ChatProvider {
  readonly name = 'gemini';
  private base: string | null = null;

  constructor(
    private apiKey: string,
    private bases: string[] = geminiBasesFor(apiKey),
    private fetchImpl: typeof fetch = fetch,
    private firstByteTimeoutMs = 45_000,
  ) {}

  private body(req: ChatRequest) {
    const system = [req.system.stable, req.system.dynamic, req.json ? 'Respond with a single valid JSON object only.' : ''].filter(Boolean).join('\n\n');
    const contents = req.messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: toParts(m.content) }));
    if (!contents.length || contents[0].role !== 'user') contents.unshift({ role: 'user', parts: [{ text: '[A conversa começa.]' }] });
    return {
      systemInstruction: { parts: [{ text: system }] },
      contents,
      safetySettings: SAFETY,
      generationConfig: {
        maxOutputTokens: req.maxTokens,
        ...(req.temperature != null ? { temperature: req.temperature } : {}),
        ...(req.json ? { responseMimeType: 'application/json' } : {}),
        // Thinking adds latency to chat; a small budget keeps quality for JSON tasks.
        thinkingConfig: { thinkingBudget: req.json ? 512 : 0 },
      },
    };
  }

  private async post(base: string, model: string, req: ChatRequest): Promise<Response> {
    const id = base === VERTEX_EXPRESS_BASE ? (VERTEX_MODEL[model] ?? model) : model;
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    req.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => ctrl.abort(), this.firstByteTimeoutMs);
    try {
      return await this.fetchImpl(`${base}/${id}:streamGenerateContent?alt=sse`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify(this.body(req)),
        signal: ctrl.signal,
      });
    } catch (e) {
      const aborted = req.signal?.aborted ?? false;
      throw new ProviderError(this.name, null, aborted ? 'aborted' : (e as Error).message || 'timeout', !aborted);
    } finally {
      clearTimeout(timer);
      req.signal?.removeEventListener('abort', onAbort);
    }
  }

  async *stream(model: string, req: ChatRequest): AsyncGenerator<StreamChunk> {
    const candidates = this.base ? [this.base] : this.bases;
    let res: Response | null = null;
    let lastError = '';
    for (const base of candidates) {
      res = await this.post(base, model, req);
      // A key from the other product is rejected with 400/401/403/404: try the next base.
      if (!this.base && [400, 401, 403, 404].includes(res.status) && base !== candidates[candidates.length - 1]) {
        lastError = (await res.text().catch(() => '')).slice(0, 300);
        res = null;
        continue;
      }
      if (res.ok) this.base = base;
      break;
    }
    if (!res || !res.ok || !res.body) {
      const status = res?.status ?? null;
      const text = res ? await res.text().catch(() => '') : lastError;
      throw new ProviderError(this.name, status, text.slice(0, 500) || 'request failed', isRetryable(status));
    }

    let inputTokens = 0;
    let outputTokens = 0;
    let stopReason: string | null = null;
    let emitted = false;
    for await (const rec of readSse(res.body, req.signal)) {
      let evt: any;
      try {
        evt = JSON.parse(rec.data);
      } catch {
        continue;
      }
      if (evt.error) throw new ProviderError(this.name, evt.error.code ?? null, evt.error.message ?? 'stream error', true);
      if (evt.promptFeedback?.blockReason) throw new ProviderError(this.name, 400, `blocked: ${evt.promptFeedback.blockReason}`, true);
      const cand = evt.candidates?.[0];
      for (const part of cand?.content?.parts ?? []) {
        if (typeof part.text === 'string' && part.text && !part.thought) {
          emitted = true;
          yield { type: 'text', text: part.text };
        }
      }
      if (cand?.finishReason) stopReason = cand.finishReason === 'STOP' ? 'stop' : String(cand.finishReason).toLowerCase();
      if (evt.usageMetadata) {
        inputTokens = evt.usageMetadata.promptTokenCount ?? inputTokens;
        outputTokens = evt.usageMetadata.candidatesTokenCount ?? outputTokens;
      }
    }
    // Blocked or empty answers fall back to the next model instead of showing nothing.
    if (!emitted) throw new ProviderError(this.name, null, `empty answer (${stopReason ?? 'no text'})`, true);
    yield { type: 'end', stopReason, inputTokens, outputTokens };
  }
}
