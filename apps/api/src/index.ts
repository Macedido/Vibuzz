import { serve } from '@hono/node-server';
import { buildApp } from './app';
import { loadEnv } from './config';
import { createLogger } from './lib/log';
import { createServices } from './services';

/** Node entry (local dev, Docker, Render...). Supabase Edge uses src/edge.ts. */
async function main() {
  const env = loadEnv(process.env);
  const log = createLogger(env.LOG_LEVEL);
  const services = createServices(env, log);
  const app = buildApp(services, { log });

  const status = services.ai.status();
  if (status.missing.length) log.warn({ missing: status.missing }, 'AI integrations not fully configured');

  if (env.WORKER_ENABLED ?? true) services.worker.start();

  const server = serve({ fetch: app.fetch, port: env.PORT, hostname: env.HOST }, (info) => {
    log.info({ port: info.port }, 'vibuzz api listening');
  });

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'shutting down');
    await services.worker.stop();
    await services.flushUsage();
    server.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
