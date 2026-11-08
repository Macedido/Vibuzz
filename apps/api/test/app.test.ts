import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app';
import { loadEnv } from '../src/config';
import { resolveServiceKey, stripFunctionPrefix } from '../src/edge';
import { AppError } from '../src/lib/errors';
import type { Services } from '../src/services';

const env = loadEnv({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'x'.repeat(40), NODE_ENV: 'test', RATE_LIMIT_PER_MINUTE: '3' });
const USER = '11111111-1111-1111-1111-111111111111';

function fakeServices(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    env,
    db: {
      auth: {
        getUser: vi.fn(async (token: string) =>
          token === 'good' ? { data: { user: { id: USER } }, error: null } : { data: { user: null }, error: { message: 'bad' } },
        ),
      },
      rpc: vi.fn(async (fn: string, args: { p_token?: string }) => (fn === 'verify_cron_token' ? { data: args.p_token === 'cron-ok', error: null } : { data: null, error: null })),
    },
    ai: { status: () => ({ chat: false, embeddings: false, vision: false, moderation: 'none', missing: ['x'] }) },
    conversations: {
      create: vi.fn(async () => ({ id: 'c1' })),
      send: vi.fn(async (_u: string, _c: string, _i: unknown, emit: (e: unknown) => void) => {
        emit({ type: 'delta', messageId: 'm', text: 'Olá' });
      }),
      regenerate: vi.fn(async () => {
        throw new AppError(429, 'daily_limit', 'Limite diário.');
      }),
    },
    worker: { drain: vi.fn(async () => 2) },
    maintenance: vi.fn(async () => {}),
    life: { runDue: vi.fn(async () => 1) },
    billing: {
      info: () => ({ enabled: true, currency: 'BRL', prices: { month: 14.9, year: 149 } }),
      process: vi.fn(async () => ({ status: 'approved', userId: USER, plan: 'month', premiumUntil: null })),
      verifyWebhook: vi.fn(async () => true),
      checkout: vi.fn(async () => ({ url: 'https://mp.test', preferenceId: 'p' })),
    },
    flushUsage: vi.fn(async () => {}),
    kick: vi.fn(),
    ...overrides,
  } as unknown as Services;
}

const auth = { authorization: 'Bearer good', 'content-type': 'application/json' };

describe('HTTP API', () => {
  it('exposes prices and the payment webhook without login, checkout only with login', async () => {
    const services = fakeServices();
    const app = buildApp(services);
    expect(((await (await app.request('/v1/billing')).json()) as { prices: { month: number } }).prices.month).toBe(14.9);
    const hook = await app.request('/v1/billing/webhook?data.id=123&type=payment', { method: 'POST', body: JSON.stringify({ type: 'payment', data: { id: '123' } }) });
    expect(await hook.json()).toEqual({ ok: true, status: 'approved' });
    expect((services as unknown as { billing: { process: ReturnType<typeof vi.fn> } }).billing.process).toHaveBeenCalledWith('123');
    expect((await app.request('/v1/billing/checkout', { method: 'POST', body: JSON.stringify({ plan: 'month' }) })).status).toBe(401);
    const ok = await app.request('/v1/billing/checkout', { method: 'POST', headers: auth, body: JSON.stringify({ plan: 'month' }) });
    expect(((await ok.json()) as { url: string }).url).toBe('https://mp.test');
    expect((await app.request('/v1/billing/checkout', { method: 'POST', headers: auth, body: JSON.stringify({ plan: 'vitalicio' }) })).status).toBe(400);
  });

  it('serves health and status without auth, with CORS', async () => {
    const app = buildApp(fakeServices());
    expect(await (await app.request('/health')).json()).toEqual({ ok: true });
    const res = await app.request('/v1/status', { headers: { origin: 'https://macedido.github.io' } });
    expect(((await res.json()) as { missing: string[] }).missing).toEqual(['x']);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const pre = await app.request('/v1/conversations', { method: 'OPTIONS', headers: { origin: 'https://x.dev', 'access-control-request-method': 'POST' } });
    expect(pre.status).toBe(204);
  });

  it('requires a valid Supabase token', async () => {
    const app = buildApp(fakeServices());
    expect((await app.request('/v1/conversations', { method: 'POST', body: '{}' })).status).toBe(401);
    expect((await app.request('/v1/conversations', { method: 'POST', body: '{}', headers: { authorization: 'Bearer nope' } })).status).toBe(401);
  });

  it('validates input with zod', async () => {
    const app = buildApp(fakeServices());
    const res = await app.request('/v1/conversations', { method: 'POST', headers: auth, body: JSON.stringify({ characterId: 'not-a-uuid' }) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('invalid_input');
  });

  it('creates conversations for the authenticated user', async () => {
    const s = fakeServices();
    const app = buildApp(s);
    const res = await app.request('/v1/conversations', { method: 'POST', headers: auth, body: JSON.stringify({ characterId: '22222222-2222-2222-2222-222222222222' }) });
    expect(await res.json()).toEqual({ id: 'c1' });
    expect((s.conversations.create as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(USER);
  });

  it('streams replies as server-sent events, including errors, and kicks the worker', async () => {
    const s = fakeServices();
    const app = buildApp(s);
    const ok = await app.request('/v1/conversations/33333333-3333-3333-3333-333333333333/messages', { method: 'POST', headers: auth, body: JSON.stringify({ content: 'oi' }) });
    expect(ok.headers.get('content-type')).toContain('text/event-stream');
    const text = await ok.text();
    expect(text).toContain('data: {"type":"delta","messageId":"m","text":"Olá"}');
    expect(text).toContain('data: {"type":"done"}');
    expect(s.kick).toHaveBeenCalled();

    const err = await app.request('/v1/conversations/33333333-3333-3333-3333-333333333333/regenerate', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ messageId: '44444444-4444-4444-4444-444444444444' }),
    });
    expect(await err.text()).toContain('"type":"error","code":"daily_limit"');
  });

  it('rate limits bursts per user', async () => {
    const app = buildApp(fakeServices());
    const call = () => app.request('/v1/conversations', { method: 'POST', headers: auth, body: JSON.stringify({ characterId: '22222222-2222-2222-2222-222222222222' }) });
    for (let i = 0; i < 3; i++) expect((await call()).status).toBe(200);
    const blocked = await call();
    expect(blocked.status).toBe(429);
    expect(((await blocked.json()) as { code: string }).code).toBe('rate_limited');
  });

  it('protects the cron tick with a token', async () => {
    const s = fakeServices();
    const app = buildApp(s);
    expect((await app.request('/v1/internal/tick', { method: 'POST', headers: { 'x-cron-token': 'wrong' } })).status).toBe(401);
    const ok = await app.request('/v1/internal/tick', { method: 'POST', headers: { 'x-cron-token': 'cron-ok' } });
    expect(await ok.json()).toEqual({ processed: 2, spontaneous: 1 });
    expect(s.maintenance).toHaveBeenCalled();
  });

  it('returns JSON 404 for unknown routes', async () => {
    const res = await buildApp(fakeServices()).request('/nope', { headers: auth });
    expect(res.status).toBe(404);
  });
});

describe('edge entry helpers', () => {
  it('strips the function name from the path', () => {
    expect(stripFunctionPrefix('/vibuzz-api/v1/status')).toBe('/v1/status');
    expect(stripFunctionPrefix('/functions/v1/vibuzz-api/health')).toBe('/health');
    expect(stripFunctionPrefix('/vibuzz-api')).toBe('/');
    expect(stripFunctionPrefix('/v1/status')).toBe('/v1/status');
  });
  it('prefers the new secret key and falls back to service_role', () => {
    expect(resolveServiceKey({ SUPABASE_SECRET_KEYS: '{"default":"sb_secret_abc"}', SUPABASE_SERVICE_ROLE_KEY: 'legacy' })).toBe('sb_secret_abc');
    expect(resolveServiceKey({ SUPABASE_SECRET_KEYS: 'not json', SUPABASE_SERVICE_ROLE_KEY: 'legacy' })).toBe('legacy');
    expect(resolveServiceKey({ SUPABASE_SERVICE_ROLE_KEY: 'legacy' })).toBe('legacy');
  });
});
