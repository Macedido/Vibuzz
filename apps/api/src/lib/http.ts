import type { StreamEvent } from '@vibuzz/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError, type z } from 'zod';
import { AppError, ProviderError } from './errors';

/** Validates a body/params with zod, mapping failures to a 400. */
export function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new AppError(400, 'invalid_input', 'Dados inválidos.', r.error.flatten());
  return r.data;
}

export function errorPayload(e: unknown): { status: number; code: string; message: string; details?: unknown } {
  if (e instanceof AppError) return { status: e.status, code: e.code, message: e.message, details: e.details };
  if (e instanceof ZodError) return { status: 502, code: 'ai_bad_output', message: 'A IA retornou um formato inesperado. Tente novamente.' };
  if (e instanceof ProviderError) {
    return { status: 502, code: 'ai_unavailable', message: 'O serviço de IA está indisponível no momento. Tente novamente em instantes.' };
  }
  return { status: 500, code: 'internal', message: 'Erro interno.' };
}

/**
 * Opens a Server-Sent Events stream and runs `work`. Errors become an `error`
 * event; client disconnects abort generation (partial text is kept).
 */
export async function sse(req: FastifyRequest, reply: FastifyReply, work: (emit: (e: StreamEvent) => void, signal: AbortSignal) => Promise<void>) {
  const controller = new AbortController();
  reply.raw.on('close', () => controller.abort());
  reply.hijack();
  const origin = req.headers.origin;
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
    ...(origin ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}),
  });
  const emit = (e: StreamEvent) => {
    if (!reply.raw.writableEnded) reply.raw.write(`data: ${JSON.stringify(e)}\n\n`);
  };
  const ping = setInterval(() => !reply.raw.writableEnded && reply.raw.write(': ping\n\n'), 15000);
  try {
    await work(emit, controller.signal);
    emit({ type: 'done' });
  } catch (e) {
    if (!controller.signal.aborted) {
      const p = errorPayload(e);
      if (p.status >= 500) req.log.error({ err: e }, 'stream failed');
      emit({ type: 'error', code: p.code, message: p.message });
    }
  } finally {
    clearInterval(ping);
    reply.raw.end();
  }
}
