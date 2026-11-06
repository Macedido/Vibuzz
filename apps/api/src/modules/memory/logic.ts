import { MEMORY_CATEGORIES } from '@vibuzz/shared';
import { z } from 'zod';

/** Pure helpers for the memory engine (unit-tested). */

export const extractionSchema = z.object({
  create: z
    .array(
      z.object({
        category: z.enum(MEMORY_CATEGORIES),
        content: z.string().trim().min(3).max(500),
        importance: z.number().min(0).max(1).default(0.5),
        confidence: z.number().min(0).max(1).default(0.8),
        holder: z.string().nullable().default(null),
        sources: z.array(z.number().int()).default([]),
      }),
    )
    .default([]),
  update: z
    .array(
      z.object({
        ref: z.string(),
        content: z.string().trim().min(3).max(500),
        importance: z.number().min(0).max(1).optional(),
        sources: z.array(z.number().int()).default([]),
      }),
    )
    .default([]),
  supersede: z.array(z.object({ ref: z.string(), reason: z.string().default('') })).default([]),
});
export type Extraction = z.infer<typeof extractionSchema>;

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export function normalizeText(t: string): string {
  return t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Word-set Jaccard similarity: the fallback duplicate test when embeddings are off. */
export function jaccard(a: string, b: string): number {
  const A = new Set(normalizeText(a).split(' ').filter((w) => w.length > 2));
  const B = new Set(normalizeText(b).split(' ').filter((w) => w.length > 2));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

export const DUPLICATE_COSINE = 0.92;
export const DUPLICATE_JACCARD = 0.8;

export function isDuplicate(
  candidate: { content: string; embedding?: number[] | null },
  existing: { content: string; embedding?: number[] | null; similarity?: number },
): boolean {
  if (existing.similarity != null) return existing.similarity >= DUPLICATE_COSINE;
  if (candidate.embedding && existing.embedding) return cosine(candidate.embedding, existing.embedding) >= DUPLICATE_COSINE;
  return jaccard(candidate.content, existing.content) >= DUPLICATE_JACCARD;
}

/** Maps 1-based message numbers from the model back to ids, dropping invalid ones. */
export function resolveSources(nums: number[], batchIds: string[]): string[] {
  const out = new Set<string>();
  for (const n of nums) {
    const id = batchIds[n - 1];
    if (id) out.add(id);
  }
  return [...out];
}

/** Which uncovered messages to summarise next (keeps a raw recent window). */
export function nextSummaryChunk<T extends { id: string }>(
  path: T[],
  coveredUntilIndex: number,
  opts = { recentWindow: 24, minChunk: 20, maxChunk: 40 },
): T[] {
  const start = coveredUntilIndex + 1;
  const end = path.length - opts.recentWindow;
  if (end - start < opts.minChunk) return [];
  return path.slice(start, Math.min(end, start + opts.maxChunk));
}

/** Parses a pgvector value returned by PostgREST ("[0.1,0.2]") into numbers. */
export function parseVector(v: unknown): number[] | null {
  if (Array.isArray(v)) return v as number[];
  if (typeof v === 'string' && v.startsWith('[')) return JSON.parse(v);
  return null;
}

export function toVectorLiteral(v: number[] | null | undefined): string | null {
  return v ? `[${v.join(',')}]` : null;
}
