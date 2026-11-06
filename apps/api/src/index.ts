import { buildApp } from './app';
import { loadEnv } from './config';
import { createServices } from './services';

async function main() {
  const env = loadEnv();
  // Temporary logger for service construction; the app creates its own.
  const bootstrap = await import('fastify').then((m) => m.default({ logger: { level: env.LOG_LEVEL } }));
  const services = createServices(env, bootstrap.log);
  const app = await buildApp(services);

  const status = services.ai.status();
  if (status.missing.length) app.log.warn({ missing: status.missing }, 'AI integrations not fully configured');

  const workerEnabled = env.WORKER_ENABLED ?? true;
  if (workerEnabled) services.worker.start();

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    await services.worker.stop();
    await services.flushUsage();
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: env.PORT, host: env.HOST });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
