import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { AppError } from './lib/errors';
import { errorPayload } from './lib/http';
import { silentLogger, type Logger } from './lib/log';
import { RateLimiter } from './lib/rate-limit';
import { registerRoutes } from './routes';
import type { Services } from './services';

export type AppEnv = { Variables: { userId: string } };

const PUBLIC_PATHS = ['/health', '/v1/status', '/v1/internal/tick'];

/**
 * HTTP layer built on Hono (Web-standard Request/Response), so the exact same
 * app runs on Node (apps/api/src/index.ts) and on Supabase Edge Functions
 * (apps/api/src/edge.ts).
 */
export function buildApp(services: Services, opts: { log?: Logger } = {}) {
  const { env, db } = services;
  const log = opts.log ?? silentLogger;
  const app = new Hono<AppEnv>();
  const limiter = new RateLimiter();

  app.use(
    '*',
    cors({
      origin: env.CORS_ORIGINS === '*' ? '*' : env.CORS_ORIGINS.split(',').map((s) => s.trim()),
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['authorization', 'content-type', 'accept', 'apikey', 'x-client-info'],
      maxAge: 86400,
    }),
  );
  app.use('*', bodyLimit({ maxSize: 1_000_000, onError: () => { throw new AppError(413, 'too_large', 'Requisição grande demais.'); } }));

  // Auth: verifies the Supabase access token; a short cache avoids a round-trip per request.
  const tokenCache = new Map<string, { userId: string; exp: number }>();
  app.use('*', async (c, next) => {
    if (c.req.method === 'OPTIONS' || PUBLIC_PATHS.includes(c.req.path)) return next();
    const header = c.req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new AppError(401, 'unauthorized', 'Faça login para continuar.');
    let userId = '';
    const cached = tokenCache.get(token);
    if (cached && cached.exp > Date.now()) {
      userId = cached.userId;
    } else {
      const { data, error } = await db.auth.getUser(token);
      if (error || !data.user) throw new AppError(401, 'unauthorized', 'Sessão expirada. Entre novamente.');
      userId = data.user.id;
      tokenCache.set(token, { userId, exp: Date.now() + 60_000 });
      if (tokenCache.size > 5000) tokenCache.clear();
    }
    // Burst protection per user (AI routes are additionally limited per day in the database).
    const heavy = c.req.method !== 'GET';
    if (!limiter.allow(`u:${userId}:${heavy ? 'w' : 'r'}`, heavy ? env.RATE_LIMIT_PER_MINUTE : env.RATE_LIMIT_PER_MINUTE * 3)) {
      throw new AppError(429, 'rate_limited', 'Muitas requisições. Aguarde um pouco.');
    }
    c.set('userId', userId);
    return next();
  });

  app.onError((err, c) => {
    const p = errorPayload(err);
    if (p.status >= 500) log.error({ err, path: c.req.path }, 'request failed');
    return c.json({ code: p.code, message: p.message, details: p.details }, p.status as 400);
  });
  app.notFound((c) => c.json({ code: 'not_found', message: 'Rota não encontrada.' }, 404));

  app.get('/health', (c) => c.json({ ok: true }));
  app.get('/v1/status', (c) => c.json(services.ai.status()));

  registerRoutes(app, services, log, limiter);
  return app;
}

export type App = ReturnType<typeof buildApp>;
