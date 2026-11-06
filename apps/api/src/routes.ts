import {
  characterUpsertSchema,
  commentSchema,
  createConversationSchema,
  creatorGenerateSchema,
  editMessageSchema,
  memoryUpdateSchema,
  profileUpdateSchema,
  regenerateFieldSchema,
  regenerateSchema,
  sendMessageSchema,
  visionAnalyzeSchema,
} from '@vibuzz/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, sse } from './lib/http';
import { must } from './lib/db';
import { AppError, badRequest, blocked, notFound } from './lib/errors';
import { assertOwnedPath } from './lib/storage';
import type { Services } from './services';

const idParams = z.object({ id: z.string().uuid() });

export async function registerRoutes(app: FastifyInstance, s: Services) {
  /* ------------------------------ characters ------------------------------ */

  app.post('/v1/characters', async (req) => s.characters.create(req.userId, parse(characterUpsertSchema, req.body)));

  app.patch('/v1/characters/:id', async (req) => {
    const { id } = parse(idParams, req.params);
    return s.characters.update(req.userId, id, parse(characterUpsertSchema, req.body));
  });

  app.delete('/v1/characters/:id', async (req) => {
    const { id } = parse(idParams, req.params);
    return s.characters.remove(req.userId, id);
  });

  app.post('/v1/characters/:id/versions/:versionId/restore', async (req) => {
    const { id, versionId } = parse(z.object({ id: z.string().uuid(), versionId: z.string().uuid() }), req.params);
    return s.characters.restoreVersion(req.userId, id, versionId);
  });

  /** Full editable data for the creator (sheet + members + versions). */
  app.get('/v1/characters/:id/edit', async (req) => {
    const { id } = parse(idParams, req.params);
    const c = await s.repo.character(id);
    if (c.creator_id !== req.userId) throw notFound('Personagem');
    const [tags, images, versions] = await Promise.all([
      s.db.from('character_tags').select('tag:tags(name)').eq('character_id', id),
      s.db.from('character_images').select('path, kind, position').eq('character_id', id).order('position'),
      s.db.from('character_versions').select('id, version, note, created_at').eq('character_id', id).order('version', { ascending: false }).limit(50),
    ]);
    const members = c.kind === 'group' ? await s.repo.groupCast(id) : [];
    return {
      id: c.id,
      kind: c.kind,
      sheet: c.sheet,
      visibility: c.visibility,
      maturity: c.maturity,
      categorySlug: c.category_slug,
      avatarPath: c.avatar_path,
      tags: ((tags.data as unknown as { tag: { name: string } }[]) ?? []).map((t) => t.tag.name),
      imagePaths: ((images.data as { path: string; kind: string }[]) ?? []).filter((i) => i.kind === 'gallery').map((i) => i.path),
      members: members.map((m) => ({ id: m.id, sheet: m.sheet, avatarPath: m.avatar_path })),
      versions: versions.data ?? [],
      currentVersion: c.current_version,
    };
  });

  /* -------------------------------- creator ------------------------------- */

  app.post('/v1/creator/generate', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const input = parse(creatorGenerateSchema, req.body);
    input.imagePaths.forEach((p) => assertOwnedPath(p, req.userId));
    const verdict = await s.moderation.checkText(input.idea, 'character', { userId: req.userId, kind: 'moderation_creator' });
    if (!verdict.allowed) throw blocked(verdict.reason);
    return s.creator.generate(input, req.userId);
  });

  app.post('/v1/creator/regenerate-field', async (req) => {
    const input = parse(regenerateFieldSchema, req.body);
    return { value: await s.creator.regenerateField(input.sheet, input.field, input.guidance, req.userId) };
  });

  app.post('/v1/vision/analyze', async (req) => {
    const input = parse(visionAnalyzeSchema, req.body);
    assertOwnedPath(input.path, req.userId);
    const img = await s.storage.downloadForModel(input.bucket, input.path);
    if (!img) throw badRequest('Imagem muito grande (máx. 4 MB).');
    return s.vision.analyze(img, { userId: req.userId, kind: 'vision' }, input.bucket === 'chat' ? 'chat' : 'character');
  });

  /* ----------------------------- conversations ---------------------------- */

  app.post('/v1/conversations', async (req) => {
    const input = parse(createConversationSchema, req.body);
    return s.conversations.create(req.userId, input.characterId, input.personaId);
  });

  app.post('/v1/conversations/:id/messages', async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const input = parse(sendMessageSchema, req.body);
    await sse(req, reply, (emit, signal) => s.conversations.send(req.userId, id, input, emit, signal));
  });

  app.post('/v1/conversations/:id/regenerate', async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const input = parse(regenerateSchema, req.body);
    await sse(req, reply, (emit, signal) => s.conversations.regenerate(req.userId, id, input.messageId, emit, signal));
  });

  app.post('/v1/conversations/:id/continue', async (req, reply) => {
    const { id } = parse(idParams, req.params);
    await sse(req, reply, (emit, signal) => s.conversations.continue(req.userId, id, emit, signal));
  });

  app.post('/v1/messages/:id/edit', async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const input = parse(editMessageSchema, req.body);
    await sse(req, reply, (emit, signal) => s.conversations.edit(req.userId, id, input, emit, signal));
  });

  app.delete('/v1/messages/:id', async (req) => {
    const { id } = parse(idParams, req.params);
    const { purge } = parse(z.object({ purge: z.enum(['0', '1', 'true', 'false']).optional() }), req.query);
    return s.conversations.deleteMessage(req.userId, id, purge === '1' || purge === 'true');
  });

  app.post('/v1/messages/:id/switch', async (req) => {
    const { id } = parse(idParams, req.params);
    return s.conversations.switchBranch(req.userId, id);
  });

  /* -------------------------------- memory -------------------------------- */

  app.patch('/v1/memories/:id', async (req) => {
    const { id } = parse(idParams, req.params);
    const { content } = parse(memoryUpdateSchema, req.body);
    const row = await s.memory.correct(id, req.userId, content);
    if (!row) throw notFound('Memória');
    return row;
  });

  /* ------------------------------- community ------------------------------ */

  app.post('/v1/comments', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const input = parse(commentSchema, req.body);
    const character = await s.repo.character(input.characterId);
    const user = await s.repo.user(req.userId);
    await s.conversations.assertCanView(character, user);
    const verdict = await s.moderation.checkText(input.body, 'comment', { userId: req.userId, kind: 'moderation_comment', targetType: 'comment' });
    if (!verdict.allowed) throw blocked(verdict.reason);
    return must(
      await s.db
        .from('comments')
        .insert({ character_id: input.characterId, user_id: req.userId, body: input.body, parent_id: input.parentId ?? null })
        .select('id, body, created_at')
        .single(),
      'comment',
    );
  });

  /* -------------------------------- profile ------------------------------- */

  app.patch('/v1/profile', async (req) => {
    const input = parse(profileUpdateSchema, req.body);
    const publicText = [input.displayName, input.username, input.bio].filter(Boolean).join('\n');
    if (publicText) {
      const verdict = await s.moderation.checkText(publicText, 'profile', { userId: req.userId, kind: 'moderation_profile', targetType: 'user', targetId: req.userId });
      if (!verdict.allowed) throw blocked(verdict.reason);
    }
    if (input.avatarPath) {
      assertOwnedPath(input.avatarPath, req.userId);
      const img = await s.storage.downloadForModel('media', input.avatarPath);
      if (!img) throw badRequest('Imagem muito grande (máx. 4 MB).');
      const v = await s.moderation.checkImage(img, 'image_public', { userId: req.userId, kind: 'moderation_image', targetType: 'user', targetId: req.userId });
      if (!v.allowed) throw blocked(`Imagem não permitida: ${v.reason}`);
    }
    if (input.username) {
      const { data } = await s.db.from('user_profiles').select('id').ilike('username', input.username).neq('id', req.userId).maybeSingle();
      if (data) throw new AppError(409, 'username_taken', 'Esse nome de usuário já está em uso.');
    }
    const patch: Record<string, unknown> = {};
    if (input.displayName !== undefined) patch.display_name = input.displayName;
    if (input.username !== undefined) patch.username = input.username;
    if (input.bio !== undefined) patch.bio = input.bio;
    if (input.avatarPath !== undefined) patch.avatar_path = input.avatarPath;
    if (Object.keys(patch).length) must(await s.db.from('user_profiles').update(patch).eq('id', req.userId), 'profile');
    if (input.allowMature !== undefined) {
      const { error } = await s.db.from('users').update({ allow_mature: input.allowMature }).eq('id', req.userId);
      if (error) throw new AppError(403, 'mature_requires_adult', 'Conteúdo adulto é apenas para maiores de 18 anos.');
    }
    return must(await s.db.from('user_profiles').select('*').eq('id', req.userId).single(), 'profile');
  });

  app.get('/v1/me/usage', async (req) => {
    const { data } = await s.db.rpc('usage_today', { p_user: req.userId });
    const row = (data as { chat_messages: number; cost_usd: number }[] | null)?.[0];
    return { messagesToday: Number(row?.chat_messages ?? 0), dailyLimit: s.env.DAILY_MESSAGE_LIMIT };
  });

  /** Permanently deletes the account and every piece of data (LGPD/GDPR). */
  app.delete('/v1/account', async (req) => {
    const uid = req.userId;
    await s.storage.removeFolder('media', uid).catch((e) => req.log.error({ err: e }, 'media cleanup failed'));
    await s.storage.removeFolder('chat', uid).catch((e) => req.log.error({ err: e }, 'chat cleanup failed'));
    const { error } = await s.db.auth.admin.deleteUser(uid);
    if (error) throw new AppError(500, 'delete_failed', 'Não foi possível excluir a conta. Tente novamente.');
    return { deleted: true };
  });
}
