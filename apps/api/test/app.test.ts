import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app';
import { loadEnv } from '../src/config';
import { AppError } from '../src/lib/errors';
import type { Services } from '../src/services';

const env = loadEnv({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'x'.repeat(40), NODE_ENV: 'test' } as NodeJS.ProcessEnv);

function fakeServices(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    env,
    db: {
      auth: {
        getUser: vi.fn(async (token: string) =>
          token === 'good' ? { data: { user: { id: '11111111-1111-1111-1111-111111111111' } }, error: null } : { data: { user: null }, error: { message: 'bad' } },
        ),
      },
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
    ...overrides,
  } as unknown as Services;
}

describe('HTTP API', () => {
  it('serves health and status without auth', async () => {
    const app = await buildApp(fakeServices(), { logger: false });
    expect((await app.inject({ url: '/health' })).json()).toEqual({ ok: true });
    expect((await app.inject({ url: '/v1/status' })).json().missing).toEqual(['x']);
  });

  it('requires a valid Supabase token', async () => {
    const app = await buildApp(fakeServices(), { logger: false });
    const none = await app.inject({ method: 'POST', url: '/v1/conversations', payload: {} });
    expect(none.statusCode).toBe(401);
    const bad = await app.inject({ method: 'POST', url: '/v1/conversations', headers: { authorization: 'Bearer nope' }, payload: {} });
    expect(bad.statusCode).toBe(401);
  });

  it('validates input with zod', async () => {
    const app = await buildApp(fakeServices(), { logger: false });
    const res = await app.inject({ method: 'POST', url: '/v1/conversations', headers: { authorization: 'Bearer good' }, payload: { characterId: 'not-a-uuid' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('invalid_input');
  });

  it('creates conversations for the authenticated user', async () => {
    const s = fakeServices();
    const app = await buildApp(s, { logger: false });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/conversations',
      headers: { authorization: 'Bearer good' },
      payload: { characterId: '22222222-2222-2222-2222-222222222222' },
    });
    expect(res.json()).toEqual({ id: 'c1' });
    expect((s.conversations.create as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('streams replies as server-sent events, including errors', async () => {
    const app = await buildApp(fakeServices(), { logger: false });
    const ok = await app.inject({
      method: 'POST',
      url: '/v1/conversations/33333333-3333-3333-3333-333333333333/messages',
      headers: { authorization: 'Bearer good' },
      payload: { content: 'oi' },
    });
    expect(ok.headers['content-type']).toContain('text/event-stream');
    expect(ok.body).toContain('data: {"type":"delta","messageId":"m","text":"Olá"}');
    expect(ok.body).toContain('data: {"type":"done"}');

    const err = await app.inject({
      method: 'POST',
      url: '/v1/conversations/33333333-3333-3333-3333-333333333333/regenerate',
      headers: { authorization: 'Bearer good' },
      payload: { messageId: '44444444-4444-4444-4444-444444444444' },
    });
    expect(err.body).toContain('"type":"error","code":"daily_limit"');
  });
});
