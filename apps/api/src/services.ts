import { PLAN_LIMITS } from '@vibuzz/shared';
import type { Env } from './config';
import { createAdminClient, type Db } from './lib/db';
import type { Logger } from './lib/log';
import { StorageService } from './lib/storage';
import { AiService, type UsageRecord } from './modules/ai/service';
import { CharacterService } from './modules/characters/service';
import { Repo } from './modules/conversations/repo';
import { ConversationService } from './modules/conversations/service';
import { CreatorService } from './modules/creator/service';
import { ImageService } from './modules/images/service';
import { LifeService } from './modules/life/service';
import { PushService } from './modules/push/service';
import { IntelligenceEngine } from './modules/intelligence/engine';
import { SceneService } from './modules/intelligence/scene';
import { JobWorker } from './modules/jobs/worker';
import { MemoryService } from './modules/memory/service';
import { ModerationService } from './modules/moderation/service';
import { VisionService } from './modules/vision/service';

export interface Services {
  env: Env;
  db: Db;
  ai: AiService;
  repo: Repo;
  storage: StorageService;
  moderation: ModerationService;
  vision: VisionService;
  memory: MemoryService;
  scene: SceneService;
  engine: IntelligenceEngine;
  conversations: ConversationService;
  characters: CharacterService;
  creator: CreatorService;
  images: ImageService;
  push: PushService;
  life: LifeService;
  worker: JobWorker;
  flushUsage: () => Promise<void>;
  maintenance: () => Promise<void>;
  /** Lets queued jobs run soon after a request (no-op where a worker loop runs). */
  kick: () => void;
}

export interface RuntimeHooks {
  /** Keeps background work alive after the response (EdgeRuntime.waitUntil on Supabase). */
  background?: (p: Promise<unknown>) => void;
  /** Serverless: drain jobs after requests instead of running a loop. */
  serverless?: boolean;
}

/** Buffers usage rows and writes them in batches (accounting never blocks a reply). */
function usageWriter(db: Db, log: Logger, autoFlush: boolean) {
  let buffer: UsageRecord[] = [];
  const flush = async () => {
    if (!buffer.length) return;
    const rows = buffer;
    buffer = [];
    const { error } = await db.from('usage_records').insert(
      rows.map((r) => ({
        user_id: r.userId ?? null,
        conversation_id: r.conversationId ?? null,
        kind: r.kind,
        provider: r.provider,
        model: r.model,
        tier: r.tier,
        input_tokens: r.inputTokens,
        output_tokens: r.outputTokens,
        cost_usd: r.costUsd,
        latency_ms: r.latencyMs,
        success: r.success,
        error: r.error ?? null,
      })),
    );
    if (error) log.error({ err: error.message }, 'usage write failed');
  };
  if (autoFlush) {
    const timer = setInterval(() => void flush(), 2000) as unknown as { unref?: () => void };
    timer.unref?.();
  }
  return {
    sink: (r: UsageRecord) => {
      buffer.push(r);
      if (!r.success) log.warn({ provider: r.provider, model: r.model, kind: r.kind, err: r.error }, 'ai call failed');
      if (buffer.length >= 20) void flush();
    },
    flush,
  };
}

export function createServices(env: Env, log: Logger, hooks: RuntimeHooks = {}): Services {
  const db = createAdminClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const usage = usageWriter(db, log, !hooks.serverless);
  const ai = AiService.fromEnv(env, usage.sink);
  const repo = new Repo(db, { immediateJobs: hooks.serverless });
  const storage = new StorageService(db);
  const moderation = new ModerationService(ai, db, { moderatePrivateChat: ai.hasPaidChat || env.MODERATE_PRIVATE_CHAT === true });
  const vision = new VisionService(ai);
  const memory = new MemoryService(repo, ai);
  const scene = new SceneService(repo, ai);
  const images = new ImageService(ai, db, { baseUrl: env.POLLINATIONS_IMAGE_URL });
  const engine = new IntelligenceEngine(repo, ai, memory, storage, ai.supportsInlineImages, env.IMAGE_GEN === false ? undefined : images, (premium) =>
    PLAN_LIMITS[premium ? 'premium' : 'free'].imagesPerDay,
  );
  const push = new PushService(db, log);
  const life = new LifeService(repo, engine, push, log, env.SUPABASE_URL);
  const conversations = new ConversationService(env, repo, engine, memory, moderation, vision, storage);
  const characters = new CharacterService(repo, moderation, storage, ai);
  const creator = new CreatorService(ai, vision, storage);

  const maintenance = async () => {
    const purged = await conversations.maintenancePurge();
    await db.from('jobs').delete().in('status', ['done', 'failed']).lt('updated_at', new Date(Date.now() - 7 * 86400_000).toISOString());
    if (purged) log.info({ purged }, 'purged deleted messages');
  };

  const worker = new JobWorker(
    db,
    {
      consolidate_memory: (p) => memory.consolidate(p.conversationId),
      summarize: (p) => memory.summarize(p.conversationId),
      rebuild_memory: (p) => memory.rebuild(p.memoryId),
      update_scene: (p) => scene.update(p.conversationId, p.messageId),
      embed_character: (p) => characters.embed(p.characterId),
    },
    log,
    env.WORKER_CONCURRENCY,
    maintenance,
  );

  const background = hooks.background ?? ((p: Promise<unknown>) => void p.catch(() => {}));
  const kick = hooks.serverless
    ? () => background(worker.drain(60_000).then(() => usage.flush()))
    : () => background(usage.flush());

  return {
    env,
    db,
    ai,
    repo,
    storage,
    moderation,
    vision,
    memory,
    scene,
    engine,
    conversations,
    characters,
    creator,
    images,
    push,
    life,
    worker,
    flushUsage: usage.flush,
    maintenance: () => worker.maybeMaintain(),
    kick,
  };
}
