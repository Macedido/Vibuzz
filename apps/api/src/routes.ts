import {
  characterUpsertSchema,
  commentSchema,
  createConversationSchema,
  creatorGenerateSchema,
  editMessageSchema,
  memoryUpdateSchema,
  portraitSchema,
  profileUpdateSchema,
  regenerateFieldSchema,
  regenerateSchema,
  sendMessageSchema,
  visionAnalyzeSchema,
} from '@vibuzz/shared';
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from './app';
import { must } from './lib/db';
import { AppError, badRequest, blocked, notFound } from './lib/errors';
import { parse, sse, type Emit } from './lib/http';
import type { Logger } from './lib/log';
import type { RateLimiter } from './lib/rate-limit';
import { assertOwnedPath } from './lib/storage';
import type { Services } from './services';

const id = z.string().uuid();
const idParams = z.object({ id });

type C = Context<AppEnv>;
const body = (c: C) => c.req.json().catch(() => ({}));
const uid = (c: C) => c.get('userId');

export function registerRoutes(app: Hono<AppEnv>, s: Services, log: Logger, limiter: RateLimiter) {
  /** Extra per-route limit for expensive AI calls. */
  const limit = (c: C, name: string, max: number) => {
    if (!limiter.allow(`${name}:${uid(c)}`, max)) throw new AppError(429, 'rate_limited', 'Muitas requisições. Aguarde um pouco.');
  };
  /** Streams a chat action and then lets the worker process the jobs it queued. */
  const stream = (work: (emit: Emit, signal: AbortSignal) => Promise<void>) => sse(work, log, () => s.kick());

  /* ------------------------------ characters ------------------------------ */

  app.post('/v1/characters', async (c) => c.json(await s.characters.create(uid(c), parse(characterUpsertSchema, await body(c)))));

  app.patch('/v1/characters/:id', async (c) => {
    const { id } = parse(idParams, c.req.param());
    return c.json(await s.characters.update(uid(c), id, parse(characterUpsertSchema, await body(c))));
  });

  app.delete('/v1/characters/:id', async (c) => {
    const { id } = parse(idParams, c.req.param());
    return c.json(await s.characters.remove(uid(c), id));
  });

  app.post('/v1/characters/:id/versions/:versionId/restore', async (c) => {
    const p = parse(z.object({ id, versionId: id }), c.req.param());
    return c.json(await s.characters.restoreVersion(uid(c), p.id, p.versionId));
  });

  /** Full editable data for the creator (sheet + members + versions). */
  app.get('/v1/characters/:id/edit', async (c) => {
    const { id } = parse(idParams, c.req.param());
    const ch = await s.repo.character(id);
    if (ch.creator_id !== uid(c)) throw notFound('Personagem');
    const [tags, images, versions] = await Promise.all([
      s.db.from('character_tags').select('tag:tags(name)').eq('character_id', id),
      s.db.from('character_images').select('path, kind, position').eq('character_id', id).order('position'),
      s.db.from('character_versions').select('id, version, note, created_at').eq('character_id', id).order('version', { ascending: false }).limit(50),
    ]);
    const members = ch.kind === 'group' ? await s.repo.groupCast(id) : [];
    return c.json({
      id: ch.id,
      kind: ch.kind,
      sheet: ch.sheet,
      visibility: ch.visibility,
      maturity: ch.maturity,
      categorySlug: ch.category_slug,
      avatarPath: ch.avatar_path,
      tags: ((tags.data as unknown as { tag: { name: string } }[]) ?? []).map((t) => t.tag.name),
      imagePaths: ((images.data as { path: string; kind: string }[]) ?? []).filter((i) => i.kind === 'gallery').map((i) => i.path),
      members: members.map((m) => ({ id: m.id, sheet: m.sheet, avatarPath: m.avatar_path })),
      versions: versions.data ?? [],
      currentVersion: ch.current_version,
    });
  });

  /* -------------------------------- creator ------------------------------- */

  app.post('/v1/creator/generate', async (c) => {
    limit(c, 'creator', 10);
    const input = parse(creatorGenerateSchema, await body(c));
    input.imagePaths.forEach((p) => assertOwnedPath(p, uid(c)));
    const verdict = await s.moderation.checkText(input.idea, 'character', { userId: uid(c), kind: 'moderation_creator' });
    if (!verdict.allowed) throw blocked(verdict.reason);
    return c.json(await s.creator.generate(input, uid(c)));
  });

  app.post('/v1/creator/portrait', async (c) => {
    if (s.env.IMAGE_GEN === false) throw new AppError(503, 'image_disabled', 'A geração de imagens está desligada neste servidor.');
    limit(c, 'portrait', 4);
    const input = parse(portraitSchema, await body(c));
    return c.json(await s.images.generatePortrait(input.sheet, input.style, uid(c)));
  });

  app.post('/v1/creator/regenerate-field', async (c) => {
    limit(c, 'creator-field', 20);
    const input = parse(regenerateFieldSchema, await body(c));
    return c.json({ value: await s.creator.regenerateField(input.sheet, input.field, input.guidance, uid(c)) });
  });

  app.post('/v1/vision/analyze', async (c) => {
    limit(c, 'vision', 20);
    const input = parse(visionAnalyzeSchema, await body(c));
    assertOwnedPath(input.path, uid(c));
    const img = await s.storage.downloadForModel(input.bucket, input.path);
    if (!img) throw badRequest('Imagem muito grande (máx. 4 MB).');
    return c.json(await s.vision.analyze(img, { userId: uid(c), kind: 'vision' }, input.bucket === 'chat' ? 'chat' : 'character'));
  });

  /* ----------------------------- conversations ---------------------------- */

  app.post('/v1/conversations', async (c) => {
    const input = parse(createConversationSchema, await body(c));
    return c.json(await s.conversations.create(uid(c), input.characterId, input.personaId));
  });

  app.post('/v1/conversations/:id/messages', async (c) => {
    const { id } = parse(idParams, c.req.param());
    const input = parse(sendMessageSchema, await body(c));
    const user = uid(c);
    return stream((emit, signal) => s.conversations.send(user, id, input, emit, signal));
  });

  app.post('/v1/conversations/:id/regenerate', async (c) => {
    const { id } = parse(idParams, c.req.param());
    const input = parse(regenerateSchema, await body(c));
    const user = uid(c);
    return stream((emit, signal) => s.conversations.regenerate(user, id, input.messageId, emit, signal));
  });

  app.post('/v1/conversations/:id/continue', async (c) => {
    const { id } = parse(idParams, c.req.param());
    const user = uid(c);
    return stream((emit, signal) => s.conversations.continue(user, id, emit, signal));
  });

  app.post('/v1/messages/:id/edit', async (c) => {
    const { id } = parse(idParams, c.req.param());
    const input = parse(editMessageSchema, await body(c));
    const user = uid(c);
    return stream((emit, signal) => s.conversations.edit(user, id, input, emit, signal));
  });

  app.delete('/v1/messages/:id', async (c) => {
    const { id } = parse(idParams, c.req.param());
    const { purge } = parse(z.object({ purge: z.enum(['0', '1', 'true', 'false']).optional() }), c.req.query());
    const out = await s.conversations.deleteMessage(uid(c), id, purge === '1' || purge === 'true');
    s.kick();
    return c.json(out);
  });

  app.post('/v1/messages/:id/switch', async (c) => {
    const { id } = parse(idParams, c.req.param());
    return c.json(await s.conversations.switchBranch(uid(c), id));
  });

  /* -------------------------------- memory -------------------------------- */

  app.patch('/v1/memories/:id', async (c) => {
    const { id } = parse(idParams, c.req.param());
    const { content } = parse(memoryUpdateSchema, await body(c));
    const row = await s.memory.correct(id, uid(c), content);
    if (!row) throw notFound('Memória');
    return c.json(row);
  });

  /* ------------------------------- community ------------------------------ */

  app.post('/v1/comments', async (c) => {
    limit(c, 'comment', 10);
    const input = parse(commentSchema, await body(c));
    const character = await s.repo.character(input.characterId);
    const user = await s.repo.user(uid(c));
    await s.conversations.assertCanView(character, user);
    const verdict = await s.moderation.checkText(input.body, 'comment', { userId: uid(c), kind: 'moderation_comment', targetType: 'comment' });
    if (!verdict.allowed) throw blocked(verdict.reason);
    return c.json(
      must(
        await s.db
          .from('comments')
          .insert({ character_id: input.characterId, user_id: uid(c), body: input.body, parent_id: input.parentId ?? null })
          .select('id, body, created_at')
          .single(),
        'comment',
      ),
    );
  });

  /* -------------------------------- profile ------------------------------- */

  app.patch('/v1/profile', async (c) => {
    const me = uid(c);
    const input = parse(profileUpdateSchema, await body(c));
    const publicText = [input.displayName, input.username, input.bio].filter(Boolean).join('\n');
    if (publicText) {
      const verdict = await s.moderation.checkText(publicText, 'profile', { userId: me, kind: 'moderation_profile', targetType: 'user', targetId: me });
      if (!verdict.allowed) throw blocked(verdict.reason);
    }
    if (input.avatarPath) {
      assertOwnedPath(input.avatarPath, me);
      const img = await s.storage.downloadForModel('media', input.avatarPath);
      if (!img) throw badRequest('Imagem muito grande (máx. 4 MB).');
      const v = await s.moderation.checkImage(img, 'image_public', { userId: me, kind: 'moderation_image', targetType: 'user', targetId: me });
      if (!v.allowed) throw blocked(`Imagem não permitida: ${v.reason}`);
    }
    if (input.username) {
      const { data } = await s.db.from('user_profiles').select('id').ilike('username', input.username).neq('id', me).maybeSingle();
      if (data) throw new AppError(409, 'username_taken', 'Esse nome de usuário já está em uso.');
    }
    const patch: Record<string, unknown> = {};
    if (input.displayName !== undefined) patch.display_name = input.displayName;
    if (input.username !== undefined) patch.username = input.username;
    if (input.bio !== undefined) patch.bio = input.bio;
    if (input.avatarPath !== undefined) patch.avatar_path = input.avatarPath;
    if (Object.keys(patch).length) must(await s.db.from('user_profiles').update(patch).eq('id', me), 'profile');
    if (input.allowMature !== undefined) {
      const { error } = await s.db.from('users').update({ allow_mature: input.allowMature }).eq('id', me);
      if (error) throw new AppError(403, 'mature_requires_adult', 'Conteúdo adulto é apenas para maiores de 18 anos.');
    }
    return c.json(must(await s.db.from('user_profiles').select('*').eq('id', me).single(), 'profile'));
  });

  app.get('/v1/me/usage', async (c) => {
    const { data } = await s.db.rpc('usage_today', { p_user: uid(c) });
    const row = (data as { chat_messages: number; cost_usd: number }[] | null)?.[0];
    return c.json({ messagesToday: Number(row?.chat_messages ?? 0), dailyLimit: s.env.DAILY_MESSAGE_LIMIT });
  });

  /** Permanently deletes the account and every piece of data (LGPD/GDPR). */
  app.delete('/v1/account', async (c) => {
    const me = uid(c);
    await s.storage.removeFolder('media', me).catch((e) => log.error({ err: e }, 'media cleanup failed'));
    await s.storage.removeFolder('chat', me).catch((e) => log.error({ err: e }, 'chat cleanup failed'));
    const { error } = await s.db.auth.admin.deleteUser(me);
    if (error) throw new AppError(500, 'delete_failed', 'Não foi possível excluir a conta. Tente novamente.');
    return c.json({ deleted: true });
  });

  /* ------------------------------- internal ------------------------------- */

  /**
   * Called every minute by pg_cron (see migration 11) to process background jobs
   * where no long-running worker exists (Supabase Edge Functions).
   */
  app.post('/v1/internal/tick', async (c) => {
    const token = c.req.header('x-cron-token') ?? '';
    const { data } = await s.db.rpc('verify_cron_token', { p_token: token });
    if (data !== true) throw new AppError(401, 'unauthorized', 'Token inválido.');
    const processed = await s.worker.drain(45_000);
    await s.maintenance();
    await s.flushUsage();
    return c.json({ processed });
  });
}
