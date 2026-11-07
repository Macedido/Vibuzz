/**
 * Supabase Edge Functions entry (Deno). Deployed as the `vibuzz-api` function:
 * https://<project>.supabase.co/functions/v1/vibuzz-api/v1/...
 * SUPABASE_URL and the secret key are injected by the platform.
 */
import { buildApp } from './app';
import { loadEnv } from './config';
import { createLogger } from './lib/log';
import { createServices } from './services';

declare const Deno: { env: { toObject(): Record<string, string> }; serve(handler: (req: Request) => Response | Promise<Response>): unknown };
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const FUNCTION_NAME = 'vibuzz-api';

export function resolveServiceKey(raw: Record<string, string | undefined>): string | undefined {
  if (raw.SUPABASE_SECRET_KEYS) {
    try {
      const keys = JSON.parse(raw.SUPABASE_SECRET_KEYS) as Record<string, string>;
      if (keys.default) return keys.default;
    } catch {
      /* fall through to the legacy key */
    }
  }
  return raw.SUPABASE_SERVICE_ROLE_KEY;
}

/** Strips "/vibuzz-api" (the function name) so routes match the Node server. */
export function stripFunctionPrefix(pathname: string, name = FUNCTION_NAME): string {
  const prefixes = [`/functions/v1/${name}`, `/${name}`];
  for (const p of prefixes) if (pathname === p || pathname.startsWith(`${p}/`)) return pathname.slice(p.length) || '/';
  return pathname;
}

export function startEdge() {
  const raw: Record<string, string | undefined> = { ...Deno.env.toObject() };
  raw.SUPABASE_SERVICE_ROLE_KEY = resolveServiceKey(raw);
  const env = loadEnv(raw);
  const log = createLogger(env.LOG_LEVEL);
  const waitUntil = typeof EdgeRuntime !== 'undefined' ? (p: Promise<unknown>) => EdgeRuntime!.waitUntil(p.catch(() => {})) : undefined;
  const services = createServices(env, log, { serverless: true, background: waitUntil });
  const app = buildApp(services, { log });

  Deno.serve((req) => {
    const url = new URL(req.url);
    const path = stripFunctionPrefix(url.pathname);
    if (path === url.pathname) return app.fetch(req);
    url.pathname = path;
    return app.fetch(new Request(url, req));
  });
}
