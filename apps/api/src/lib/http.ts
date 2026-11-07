import type { StreamEvent } from '@vibuzz/shared';
import { ZodError, type z } from 'zod';
import { AppError, ProviderError } from './errors';
import type { Logger } from './log';

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
    return {
      status: 502,
      code: 'ai_unavailable',
      message:
        e.status === 429
          ? 'A IA gratuita está ocupada agora. Espere alguns segundos e tente de novo.'
          : 'O serviço de IA está indisponível no momento. Tente novamente em instantes.',
    };
  }
  return { status: 500, code: 'internal', message: 'Erro interno.' };
}

export type Emit = (e: StreamEvent) => void;

/**
 * Streams Server-Sent Events while `work` runs. Errors become an `error` event;
 * if the client disconnects, generation is aborted (partial text is kept).
 */
export function sse(work: (emit: Emit, signal: AbortSignal) => Promise<void>, log?: Logger, onDone?: () => void): Response {
  const controller = new AbortController();
  const encoder = new TextEncoder();
  let closed = false;
  const body = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const write = (chunk: string) => {
        if (closed) return;
        try {
          ctrl.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const emit: Emit = (e) => write(`data: ${JSON.stringify(e)}\n\n`);
      const ping = setInterval(() => write(': ping\n\n'), 15_000);
      try {
        await work(emit, controller.signal);
        emit({ type: 'done' });
      } catch (e) {
        if (!controller.signal.aborted) {
          const p = errorPayload(e);
          if (p.status >= 500) log?.error({ err: e }, 'stream failed');
          emit({ type: 'error', code: p.code, message: p.message });
        }
      } finally {
        clearInterval(ping);
        closed = true;
        try {
          ctrl.close();
        } catch {
          /* already closed */
        }
        onDone?.();
      }
    },
    cancel() {
      closed = true;
      controller.abort();
    },
  });
  return new Response(body, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    },
  });
}
