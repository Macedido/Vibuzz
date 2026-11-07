import { ProviderError } from '../../../lib/errors';
import type { ChatProvider, EmbedResult, StreamChunk } from '../types';

interface SupabaseAiSession {
  run(input: string, opts: { mean_pool: boolean; normalize: boolean }): Promise<number[] | Float32Array>;
}

type SupabaseGlobal = { ai?: { Session: new (model: string) => SupabaseAiSession } };

/** True inside Supabase Edge Functions, where the built-in AI inference API exists. */
export function hasSupabaseAi(): boolean {
  return Boolean((globalThis as { Supabase?: SupabaseGlobal }).Supabase?.ai?.Session);
}

/**
 * Free embeddings computed inside Supabase Edge Functions (gte-small, 384
 * dimensions, no API key). Vectors are zero-padded to the column size; cosine
 * similarity between padded vectors equals the similarity of the originals.
 * Do not mix with another embedding model without re-embedding.
 */
export class SupabaseAiEmbeddings implements ChatProvider {
  readonly name = 'supabase';
  private sessions = new Map<string, SupabaseAiSession>();

  // eslint-disable-next-line require-yield
  async *stream(): AsyncGenerator<StreamChunk> {
    throw new ProviderError(this.name, null, 'chat not supported by supabase embeddings', false);
  }

  async embed(model: string, input: string[], dimensions: number): Promise<EmbedResult> {
    const S = (globalThis as { Supabase?: SupabaseGlobal }).Supabase;
    if (!S?.ai?.Session) throw new ProviderError(this.name, null, 'Supabase AI runtime not available', false);
    let session = this.sessions.get(model);
    if (!session) {
      session = new S.ai.Session(model);
      this.sessions.set(model, session);
    }
    const vectors: number[][] = [];
    for (const text of input) {
      const out = Array.from(await session.run(text.slice(0, 2000), { mean_pool: true, normalize: true }));
      if (out.length > dimensions) throw new ProviderError(this.name, null, `model returned ${out.length} dims, column has ${dimensions}`, false);
      while (out.length < dimensions) out.push(0);
      vectors.push(out);
    }
    return { vectors, inputTokens: 0 };
  }
}
