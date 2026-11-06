import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { AppError } from './lib/errors';
import { errorPayload } from './lib/http';
import { registerRoutes } from './routes';
import type { Services } from './services';

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
  }
}

export async function buildApp(services: Services, opts: { logger?: boolean | object } = {}): Promise<FastifyInstance> {
  const { env, db } = services;
  const app = Fastify({ logger: opts.logger ?? { level: env.LOG_LEVEL }, bodyLimit: 1_000_000, trustProxy: true });

  await app.register(cors, {
    origin: env.CORS_ORIGINS === '*' ? true : env.CORS_ORIGINS.split(',').map((s) => s.trim()),
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  let redis: unknown;
  if (env.REDIS_URL) {
    const { Redis } = await import('ioredis');
    redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
  }
  await app.register(rateLimit, {
    max: env.RATE_LIMIT_PER_MINUTE,
    timeWindow: '1 minute',
    ...(redis ? { redis: redis as never } : {}),
    keyGenerator: (req) => (req.headers.authorization ? `u:${req.headers.authorization.slice(-24)}` : `ip:${req.ip}`),
    errorResponseBuilder: () => ({ code: 'rate_limited', message: 'Muitas requisições. Aguarde um pouco.' }),
  });

  // Auth: verifies the Supabase access token; small cache avoids a round-trip per request.
  const tokenCache = new Map<string, { userId: string; exp: number }>();
  app.decorateRequest('userId', '');
  app.addHook('onRequest', async (req) => {
    if (req.method === 'OPTIONS' || req.url === '/health' || req.url.startsWith('/v1/status')) return;
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new AppError(401, 'unauthorized', 'Faça login para continuar.');
    const cached = tokenCache.get(token);
    if (cached && cached.exp > Date.now()) {
      req.userId = cached.userId;
      return;
    }
    const { data, error } = await db.auth.getUser(token);
    if (error || !data.user) throw new AppError(401, 'unauthorized', 'Sessão expirada. Entre novamente.');
    req.userId = data.user.id;
    tokenCache.set(token, { userId: data.user.id, exp: Date.now() + 60_000 });
    if (tokenCache.size > 5000) tokenCache.clear();
  });

  app.setErrorHandler((err, req, reply) => {
    const anyErr = err as { statusCode?: number; validation?: unknown; code?: string; message?: string };
    if (anyErr.statusCode === 429) return reply.status(429).send({ code: 'rate_limited', message: 'Muitas requisições. Aguarde um pouco.' });
    const p = errorPayload(err);
    if (p.status >= 500) req.log.error({ err }, 'request failed');
    return reply.status(p.status).send({ code: p.code, message: p.message, details: p.details });
  });

  app.get('/health', async () => ({ ok: true }));
  app.get('/v1/status', async () => services.ai.status());

  await registerRoutes(app, services);
  return app;
}
