import type { FastifyBaseLogger } from 'fastify';
import type { Env } from './config';
import { createAdminClient, type Db } from './lib/db';
import { StorageService } from './lib/storage';
import { AiService, type UsageRecord } from './modules/ai/service';
import { CharacterService } from './modules/characters/service';
import { Repo } from './modules/conversations/repo';
import { ConversationService } from './modules/conversations/service';
import { CreatorService } from './modules/creator/service';
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
  worker: JobWorker;
  flushUsage: () => Promise<void>;
}

/** Buffers usage rows and writes them in batches (accounting never blocks a reply). */
function usageWriter(db: Db, log: FastifyBaseLogger) {
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
  const timer = setInterval(() => void flush(), 2000);
  timer.unref();
  return {
    sink: (r: UsageRecord) => {
      buffer.push(r);
      if (!r.success) log.warn({ provider: r.provider, model: r.model, kind: r.kind, err: r.error }, 'ai call failed');
      if (buffer.length >= 50) void flush();
    },
    flush,
  };
}

export function createServices(env: Env, log: FastifyBaseLogger): Services {
  const db = createAdminClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const usage = usageWriter(db, log);
  const ai = AiService.fromEnv(env, usage.sink);
  const repo = new Repo(db);
  const storage = new StorageService(db);
  const moderation = new ModerationService(ai, db);
  const vision = new VisionService(ai);
  const memory = new MemoryService(repo, ai);
  const scene = new SceneService(repo, ai);
  const firstChat = ai.chains.advanced[0]?.provider;
  const engine = new IntelligenceEngine(repo, ai, memory, storage, firstChat === 'anthropic' || firstChat === 'openai');
  const conversations = new ConversationService(env, repo, engine, memory, moderation, vision, storage);
  const characters = new CharacterService(repo, moderation, storage, ai);
  const creator = new CreatorService(ai, vision, storage);

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
    async () => {
      const purged = await conversations.maintenancePurge();
      await db.from('jobs').delete().in('status', ['done', 'failed']).lt('updated_at', new Date(Date.now() - 7 * 86400_000).toISOString());
      if (purged) log.info({ purged }, 'purged deleted messages');
    },
  );

  return { env, db, ai, repo, storage, moderation, vision, memory, scene, engine, conversations, characters, creator, worker, flushUsage: usage.flush };
}
