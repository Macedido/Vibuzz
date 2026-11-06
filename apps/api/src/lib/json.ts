import type { z } from 'zod';

/**
 * Extracts the first JSON object/array from model output. Models sometimes wrap
 * JSON in prose or code fences; this tolerates that without eval.
 */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.search(/[[{]/);
  if (start === -1) throw new Error('No JSON found in model output');
  const open = candidate[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return JSON.parse(candidate.slice(start, i + 1));
    }
  }
  throw new Error('Unterminated JSON in model output');
}

export function parseModelJson<T>(text: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): T {
  return schema.parse(extractJson(text));
}

/** Rough token estimate (good enough for budgeting; providers report real usage). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.6);
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1).trimEnd() + '…';
}
