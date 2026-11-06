import type { StreamEvent } from '@vibuzz/shared';
import { fetch as expoFetch } from 'expo/fetch';
import { config } from './config';
import { supabase } from './supabase';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { authorization: `Bearer ${token}` } : {};
}

function networkError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  if ((e as Error)?.name === 'AbortError') return new ApiError(0, 'aborted', 'Cancelado.');
  return new ApiError(0, 'network', 'Sem conexão com o servidor. Verifique sua internet e tente de novo.');
}

/** JSON request to the Vibuzz API. */
export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  if (!config.apiUrl) throw new ApiError(0, 'not_configured', 'O servidor de IA do Vibuzz ainda não está no ar. Tente mais tarde.');
  let res: Response;
  try {
    res = await fetch(`${config.apiUrl}${path}`, {
      method: init.method ?? (init.body ? 'POST' : 'GET'),
      headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...(await authHeader()) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  } catch (e) {
    throw networkError(e);
  }
  const text = await res.text();
  const json = text ? safeJson(text) : null;
  if (!res.ok) throw new ApiError(res.status, json?.code ?? 'error', json?.message ?? `Erro ${res.status}`);
  return json as T;
}

function safeJson(t: string): any {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

/**
 * Streams Server-Sent Events from the API (chat replies). Uses expo/fetch so
 * the response body can be read incrementally on iOS and Android.
 */
export async function stream(path: string, body: unknown, onEvent: (e: StreamEvent) => void, signal?: AbortSignal): Promise<void> {
  if (!config.apiUrl) throw new ApiError(0, 'not_configured', 'O servidor de IA do Vibuzz ainda não está no ar. Tente mais tarde.');
  let res: Awaited<ReturnType<typeof expoFetch>>;
  try {
    res = await expoFetch(`${config.apiUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream', ...(await authHeader()) },
      body: JSON.stringify(body ?? {}),
      signal,
    });
  } catch (e) {
    throw networkError(e);
  }
  if (!res.ok) {
    const json = safeJson(await res.text());
    throw new ApiError(res.status, json?.code ?? 'error', json?.message ?? `Erro ${res.status}`);
  }
  if (!res.body) throw new ApiError(0, 'stream', 'Streaming indisponível.');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let failure: ApiError | null = null;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const data = block
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trimStart())
          .join('\n');
        if (!data) continue;
        const evt = safeJson(data) as StreamEvent | null;
        if (!evt) continue;
        if (evt.type === 'error') failure = new ApiError(0, evt.code, evt.message);
        onEvent(evt);
      }
    }
  } catch (e) {
    throw networkError(e);
  }
  if (failure) throw failure;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: string }).message);
  return 'Algo deu errado.';
}
