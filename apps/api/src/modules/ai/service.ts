import type { ProviderStatus } from '@vibuzz/shared';
import type { z } from 'zod';
import type { Env } from '../../config';
import { NotConfiguredError, ProviderError } from '../../lib/errors';
import { extractJson } from '../../lib/json';
import { AnthropicProvider } from './providers/anthropic';
import { GeminiProvider, geminiBasesFor } from './providers/gemini';
import { OpenAICompatibleProvider } from './providers/openai';
import { hasSupabaseAi, SupabaseAiEmbeddings } from './providers/supabase-ai';
import type { Capability, ChatProvider, ChatRequest, ChatResult, ModelRef, ModerationResult, StreamChunk, Tier, Usage } from './types';

export const EMBEDDING_DIMENSIONS = 1536;

/** Keyless free models (OVHcloud AI Endpoints anonymous tier, Pollinations). Limits are per IP and per model. */
/** Ordered by roleplay quality in our evals (Portuguese, narrator scenes, staying in role). */
export const FREE_ADVANCED = [
  'ovh:Meta-Llama-3_3-70B-Instruct',
  'ovh:gpt-oss-120b',
  'ovh:Qwen3.5-397B-A17B',
  'ovh:Qwen3.6-27B',
  'ovh:Mistral-Small-3.2-24B-Instruct-2506',
  'pollinations:openai',
] as const;
export const FREE_FAST = [
  'ovh:Mistral-Small-3.2-24B-Instruct-2506',
  'ovh:gpt-oss-20b',
  'ovh:Qwen3.5-9B',
  'ovh:Meta-Llama-3_3-70B-Instruct',
  'pollinations:openai',
] as const;
export const FREE_VISION = ['ovh:Mistral-Small-3.2-24B-Instruct-2506', 'ovh:Qwen2.5-VL-72B-Instruct'] as const;

/** USD per million tokens. Override or extend with MODEL_PRICING. */
const DEFAULT_PRICING: Record<string, { input: number; output: number }> = {
  'anthropic:claude-opus-5-5': { input: 4, output: 20 },
  'anthropic:claude-sonnet-5-5': { input: 2, output: 10 },
  'anthropic:claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'anthropic:claude-fable-5-1': { input: 10, output: 50 },
  'openai:text-embedding-3-small': { input: 0.02, output: 0 },
  'openai:text-embedding-3-large': { input: 0.13, output: 0 },
};

export interface UsageMeta {
  userId?: string | null;
  conversationId?: string | null;
  kind: string;
}

export interface UsageRecord extends UsageMeta {
  provider: string;
  model: string;
  tier: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  success: boolean;
  error?: string;
}

export type UsageSink = (rec: UsageRecord) => void;

export function parseChain(spec: string | undefined): ModelRef[] {
  if (!spec) return [];
  return spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const i = s.indexOf(':');
      if (i <= 0) throw new Error(`Invalid model spec "${s}" — use provider:model`);
      return { provider: s.slice(0, i), model: s.slice(i + 1) };
    });
}

/**
 * Provider-independent AI layer: model routing by tier, fallback chains,
 * usage/cost accounting and latency measurement.
 */
export class AiService {
  readonly chains: Record<Capability, ModelRef[]>;
  private pricing: Record<string, { input: number; output: number }>;

  constructor(
    private providers: Map<string, ChatProvider>,
    chains: Partial<Record<Capability, ModelRef[]>>,
    private sink: UsageSink,
    pricing: Record<string, { input: number; output: number }> = {},
    private moderationMode: 'openai' | 'llm' | 'none' = 'llm',
  ) {
    const usable = (refs: ModelRef[] = []) => refs.filter((r) => providers.has(r.provider));
    this.chains = {
      fast: usable(chains.fast),
      advanced: usable(chains.advanced),
      specialized: usable(chains.specialized),
      vision: usable(chains.vision),
      embedding: usable(chains.embedding),
    };
    // Gracefully reuse neighbouring tiers when one is not configured.
    if (!this.chains.advanced.length) this.chains.advanced = this.chains.specialized.length ? this.chains.specialized : this.chains.fast;
    if (!this.chains.fast.length) this.chains.fast = this.chains.advanced;
    if (!this.chains.specialized.length) this.chains.specialized = this.chains.advanced;
    if (!this.chains.vision.length) this.chains.vision = this.chains.advanced;
    this.pricing = { ...DEFAULT_PRICING, ...pricing };
  }

  static fromEnv(env: Env, sink: UsageSink): AiService {
    const providers = new Map<string, ChatProvider>();
    if (env.ANTHROPIC_API_KEY) providers.set('anthropic', new AnthropicProvider(env.ANTHROPIC_API_KEY, env.ANTHROPIC_BASE_URL));
    if (env.OPENAI_API_KEY) {
      providers.set('openai', new OpenAICompatibleProvider('openai', env.OPENAI_API_KEY, env.OPENAI_BASE_URL, { official: true }));
    }
    if (env.GEMINI_API_KEY) providers.set('gemini', new GeminiProvider(env.GEMINI_API_KEY.trim(), geminiBasesFor(env.GEMINI_API_KEY.trim(), env.GEMINI_NATIVE_BASE)));
    if (env.COMPAT_API_KEY && env.COMPAT_BASE_URL) {
      providers.set('compat', new OpenAICompatibleProvider('compat', env.COMPAT_API_KEY, env.COMPAT_BASE_URL));
    }
    const freeAi = env.FREE_AI ?? true;
    if (freeAi) {
      providers.set('ovh', new OpenAICompatibleProvider('ovh', env.OVH_API_KEY ?? '', env.OVH_BASE_URL, { firstByteTimeoutMs: 30_000 }));
      providers.set('pollinations', new OpenAICompatibleProvider('pollinations', '', env.POLLINATIONS_BASE_URL, { chatPath: '/openai', firstByteTimeoutMs: 25_000 }));
    }
    if (hasSupabaseAi()) providers.set('supabase', new SupabaseAiEmbeddings());

    const has = (p: string) => providers.has(p);
    const pick = (...specs: (string | false | undefined)[]) => specs.filter(Boolean).join(',');
    const free = (list: readonly string[]) => (freeAi ? list.join(',') : '');
    const chains: Partial<Record<Capability, ModelRef[]>> = {
      fast: parseChain(
        env.MODEL_FAST ??
          pick(has('anthropic') && 'anthropic:claude-haiku-5-5', has('gemini') && 'gemini:gemini-flash-lite-latest', has('openai') && 'openai:gpt-5-mini', free(FREE_FAST)),
      ),
      advanced: parseChain(
        env.MODEL_ADVANCED ??
          pick(has('anthropic') && 'anthropic:claude-sonnet-5-5', has('gemini') && 'gemini:gemini-flash-latest,gemini:gemini-3-flash-preview,gemini:gemini-flash-lite-latest', has('openai') && 'openai:gpt-5', free(FREE_ADVANCED)),
      ),
      specialized: parseChain(
        env.MODEL_SPECIALIZED ??
          pick(has('anthropic') && 'anthropic:claude-opus-5-5', has('gemini') && 'gemini:gemini-flash-latest,gemini:gemini-3-flash-preview,gemini:gemini-flash-lite-latest', has('openai') && 'openai:gpt-5', free(FREE_ADVANCED)),
      ),
      vision: parseChain(
        env.MODEL_VISION ??
          pick(has('anthropic') && 'anthropic:claude-sonnet-5-5', has('gemini') && 'gemini:gemini-flash-latest', has('openai') && 'openai:gpt-5-mini', free(FREE_VISION)),
      ),
      // Embedding model must stay the same once memories exist (vectors are not comparable across models).
      embedding: parseChain(
        env.MODEL_EMBEDDING ?? (has('supabase') ? 'supabase:gte-small' : has('openai') ? 'openai:text-embedding-3-small' : undefined),
      ),
    };
    let pricing: Record<string, { input: number; output: number }> = {};
    if (env.MODEL_PRICING) pricing = JSON.parse(env.MODEL_PRICING);
    const moderation = env.MODERATION_PROVIDER ?? (has('openai') ? 'openai' : 'llm');
    return new AiService(providers, chains, sink, pricing, moderation);
  }

  /** True when a keyed (non-anonymous) chat provider is configured. */
  get hasPaidChat(): boolean {
    return ['anthropic', 'openai', 'gemini', 'compat'].some((p) => this.providers.has(p));
  }

  /** Whether the primary chat model can receive images directly. */
  get supportsInlineImages(): boolean {
    return ['anthropic', 'openai', 'gemini'].includes(this.chains.advanced[0]?.provider ?? '');
  }

  status(): ProviderStatus {
    const missing: string[] = [];
    if (!this.chains.advanced.length) missing.push('Modelo de chat (GEMINI_API_KEY, ANTHROPIC_API_KEY ou FREE_AI)');
    if (!this.chains.embedding.length) missing.push('Embeddings (rodando no Supabase ou OPENAI_API_KEY) — memória usa só palavras-chave');
    if (!this.hasPaidChat && this.chains.advanced.length) missing.push('Usando IA gratuita sem chave (limitada). Para mais qualidade e volume: GEMINI_API_KEY (grátis)');
    const moderation = this.moderationMode === 'openai' && this.providers.has('openai') ? 'provider' : this.chains.fast.length && this.moderationMode !== 'none' ? 'llm' : 'none';
    if (moderation === 'none') missing.push('Moderação (OPENAI_API_KEY ou um modelo de chat)');
    return {
      chat: this.chains.advanced.length > 0,
      embeddings: this.chains.embedding.length > 0,
      vision: this.chains.vision.length > 0,
      moderation,
      missing,
    };
  }

  get hasEmbeddings() {
    return this.chains.embedding.length > 0;
  }

  cost(ref: ModelRef, usage: Usage): number {
    const p = this.pricing[`${ref.provider}:${ref.model}`];
    if (!p) return 0;
    return (usage.inputTokens * p.input + usage.outputTokens * p.output) / 1_000_000;
  }

  /**
   * Streams a chat completion. Falls back to the next model in the chain if a
   * provider fails before producing any text, and "hedges": when the current model
   * is slow to start, the next one runs in parallel and the first to answer wins.
   */
  async stream(cap: Tier | 'vision', req: ChatRequest, meta: UsageMeta, onText: (t: string) => void): Promise<ChatResult> {
    const chain = this.chains[cap];
    if (!chain.length) throw new NotConfiguredError('modelo de linguagem');
    const hedgeMs = req.hedgeMs ?? (req.json ? 12_000 : 5_000);

    type First = { a: Attempt; r: IteratorResult<StreamChunk> } | { a: Attempt; err: unknown };
    interface Attempt {
      ref: ModelRef;
      ctrl: AbortController;
      it: AsyncIterator<StreamChunk>;
      started: number;
      first: Promise<First>;
      detach: () => void;
    }
    const launch = (ref: ModelRef): Attempt => {
      const ctrl = new AbortController();
      const onAbort = () => ctrl.abort();
      req.signal?.addEventListener('abort', onAbort, { once: true });
      const it = this.providers.get(ref.provider)!.stream(ref.model, { ...req, signal: ctrl.signal })[Symbol.asyncIterator]();
      const a = { ref, ctrl, it, started: Date.now(), detach: () => req.signal?.removeEventListener('abort', onAbort) } as Attempt;
      a.first = it.next().then(
        (r): First => ({ a, r }),
        (err): First => ({ a, err }),
      );
      return a;
    };
    const stop = (a: Attempt) => {
      a.ctrl.abort();
      a.detach();
      void a.it.return?.(undefined)?.catch(() => {});
    };

    let next = 0;
    let lastError: unknown;
    const pending = new Set<Attempt>();
    pending.add(launch(chain[next++]));

    while (pending.size) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const canHedge = hedgeMs > 0 && next < chain.length;
      const hedge = canHedge ? new Promise<'hedge'>((resolve) => (timer = setTimeout(() => resolve('hedge'), hedgeMs))) : null;
      const winner = await Promise.race<First | 'hedge'>([...[...pending].map((a) => a.first), ...(hedge ? [hedge] : [])]);
      if (timer) clearTimeout(timer);

      if (winner === 'hedge') {
        pending.add(launch(chain[next++]));
        continue;
      }
      const a = winner.a;
      pending.delete(a);
      if ('err' in winner) {
        lastError = winner.err;
        a.detach();
        this.record(a.ref, cap, meta, { inputTokens: 0, outputTokens: 0 }, Date.now() - a.started, false, String((winner.err as Error)?.message ?? winner.err));
        if (req.signal?.aborted) {
          pending.forEach(stop);
          throw winner.err;
        }
        // Failed before any text: move on right away instead of waiting for the hedge timer.
        if (!pending.size && next < chain.length) pending.add(launch(chain[next++]));
        continue;
      }

      // First answer wins: cancel the others and stream this one.
      pending.forEach(stop);
      pending.clear();
      return this.consume(a.ref, a.it, winner.r, a.started, cap, meta, onText, a.detach);
    }
    throw lastError;
  }

  private async consume(
    ref: ModelRef,
    it: AsyncIterator<StreamChunk>,
    first: IteratorResult<StreamChunk>,
    started: number,
    cap: Tier | 'vision',
    meta: UsageMeta,
    onText: (t: string) => void,
    detach: () => void,
  ): Promise<ChatResult> {
    let text = '';
    let r = first;
    try {
      while (!r.done) {
        const chunk = r.value;
        if (chunk.type === 'text') {
          text += chunk.text;
          onText(chunk.text);
        } else {
          const result: ChatResult = { ...chunk, text, provider: ref.provider, model: ref.model };
          this.record(ref, cap, meta, result, Date.now() - started, true);
          return result;
        }
        r = await it.next();
      }
      // Stream ended without an explicit end chunk (aborted).
      const result: ChatResult = { text, provider: ref.provider, model: ref.model, stopReason: 'aborted', inputTokens: 0, outputTokens: 0 };
      this.record(ref, cap, meta, result, Date.now() - started, true);
      return result;
    } catch (e) {
      this.record(ref, cap, meta, { inputTokens: 0, outputTokens: 0 }, Date.now() - started, false, String((e as Error).message));
      throw e;
    } finally {
      detach();
    }
  }

  complete(cap: Tier | 'vision', req: ChatRequest, meta: UsageMeta): Promise<ChatResult> {
    return this.stream(cap, req, meta, () => {});
  }

  /** JSON completion with schema validation and one self-repair attempt. */
  async completeJson<T>(cap: Tier | 'vision', req: ChatRequest, schema: z.ZodType<T, z.ZodTypeDef, unknown>, meta: UsageMeta): Promise<T> {
    const first = await this.complete(cap, { ...req, json: true }, meta);
    try {
      return schema.parse(extractJson(first.text));
    } catch (err) {
      const repair = await this.complete(
        cap,
        {
          ...req,
          json: true,
          messages: [
            ...req.messages,
            { role: 'assistant', content: first.text.slice(0, 8000) || '{}' },
            {
              role: 'user',
              content: `Sua resposta não é um JSON válido para o formato pedido (${String((err as Error).message).slice(0, 400)}). Responda novamente apenas com o JSON corrigido.`,
            },
          ],
        },
        { ...meta, kind: `${meta.kind}_repair` },
      );
      return schema.parse(extractJson(repair.text));
    }
  }

  /** Returns null when no embedding provider is configured (callers degrade to keyword search). */
  async embed(texts: string[], meta: UsageMeta): Promise<number[][] | null> {
    const chain = this.chains.embedding;
    if (!chain.length || !texts.length) return null;
    let lastError: unknown;
    for (const ref of chain) {
      const provider = this.providers.get(ref.provider)!;
      if (!provider.embed) continue;
      const started = Date.now();
      try {
        const out = await provider.embed(ref.model, texts.map((t) => t.slice(0, 8000)), EMBEDDING_DIMENSIONS);
        this.record(ref, 'embedding', meta, { inputTokens: out.inputTokens, outputTokens: 0 }, Date.now() - started, true);
        return out.vectors;
      } catch (e) {
        lastError = e;
        this.record(ref, 'embedding', meta, { inputTokens: 0, outputTokens: 0 }, Date.now() - started, false, String((e as Error).message));
      }
    }
    throw lastError;
  }

  /** Provider moderation endpoint when available; null means "use the LLM classifier". */
  async providerModeration(input: { text?: string; imageBase64?: { data: string; mimeType: string } }): Promise<ModerationResult | null> {
    if (this.moderationMode !== 'openai') return null;
    const p = this.providers.get('openai');
    if (!p?.moderate) return null;
    return p.moderate(input);
  }

  get moderationEnabled() {
    return this.moderationMode !== 'none';
  }

  private record(ref: ModelRef, tier: string, meta: UsageMeta, usage: Usage, latencyMs: number, success: boolean, error?: string) {
    try {
      this.sink({
        ...meta,
        provider: ref.provider,
        model: ref.model,
        tier,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costUsd: this.cost(ref, usage),
        latencyMs,
        success,
        error: error?.slice(0, 500),
      });
    } catch {
      /* accounting must never break a response */
    }
  }
}

/** Picks the processing level automatically (spec §17). */
export function chooseChatTier(input: { isGroup: boolean; speakers?: number; userChars: number; hasImages: boolean; complexity?: 'normal' | 'high' }): Tier {
  if (input.complexity === 'high') return 'specialized';
  if (input.isGroup && (input.speakers ?? 1) >= 3) return 'specialized';
  if (input.userChars > 2500) return 'specialized';
  return 'advanced';
}

/** Creativity slider (0..1) → sampling temperature. */
export function creativityToTemperature(c: number): number {
  const clamped = Math.min(1, Math.max(0, c));
  return Math.round((0.3 + clamped * 0.75) * 100) / 100;
}
