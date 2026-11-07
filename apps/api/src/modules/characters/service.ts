import { characterUpsertSchema, diffSheets, PLAN_LIMITS, type CharacterSheet, type CharacterUpsert } from '@vibuzz/shared';
import { must, type CharacterRow, type Db } from '../../lib/db';
import { AppError, badRequest, blocked, forbidden, notFound } from '../../lib/errors';
import { truncate } from '../../lib/json';
import { assertOwnedPath, type StorageService } from '../../lib/storage';
import type { AiService } from '../ai/service';
import type { Repo } from '../conversations/repo';
import { sheetSuggestsMinor } from '../intelligence/prompts';
import type { ModerationService } from '../moderation/service';
import { toVectorLiteral } from '../memory/logic';

export function slugifyTag(t: string): string {
  return t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
}

function sheetText(s: CharacterSheet): string {
  return [s.name, s.tagline, s.appearance, s.personality, s.biography, s.backstory, s.speechStyle, s.universe, s.scenario, s.userRole, s.firstMessage, s.instructions]
    .filter(Boolean)
    .join('\n');
}

/** Platform rules that do not depend on a classifier. */
export function policyViolations(input: { sheet: CharacterSheet; members: CharacterSheet[]; maturity: string; categorySlug?: string | null }): string[] {
  const out: string[] = [];
  const all = [input.sheet, ...input.members];
  const minor = all.some((s) => sheetSuggestsMinor(s));
  if (minor && input.categorySlug === 'romance') out.push('Personagens menores de idade não podem estar na categoria Romance.');
  if (minor && input.maturity === 'mature') out.push('Personagens menores de idade não podem ter classificação adulta.');
  return out;
}

export class CharacterService {
  constructor(
    private repo: Repo,
    private moderation: ModerationService,
    private storage: StorageService,
    private ai: AiService,
  ) {}

  private get db(): Db {
    return this.repo.db;
  }

  private async moderate(userId: string, input: ReturnType<typeof characterUpsertSchema.parse>, characterId?: string) {
    const violations = policyViolations({ sheet: input.sheet, members: input.members.map((m) => m.sheet), maturity: input.maturity, categorySlug: input.categorySlug });
    if (violations.length) throw blocked(violations.join(' '));

    const ctx = input.visibility === 'private' ? 'chat' : 'character';
    const text = [sheetText(input.sheet), ...input.members.map((m) => sheetText(m.sheet)), input.tags.join(', ')].join('\n\n');
    const verdict = await this.moderation.checkText(text, ctx, { userId, kind: 'moderation_character', targetType: 'character', targetId: characterId });
    if (!verdict.allowed) throw blocked(verdict.reason || 'Conteúdo não permitido.');

    // Media bucket is publicly readable, so every image is checked with public rules.
    const images = [input.avatarPath, ...input.imagePaths, ...input.members.map((m) => m.avatarPath)].filter((p): p is string => Boolean(p));
    for (const path of new Set(images)) {
      assertOwnedPath(path, userId);
      const img = await this.storage.downloadForModel('media', path);
      if (!img) throw badRequest('Imagem muito grande (máx. 4 MB).');
      const v = await this.moderation.checkImage(img, 'image_public', { userId, kind: 'moderation_image', targetType: 'character', targetId: characterId });
      if (!v.allowed) throw blocked(`Imagem não permitida: ${v.reason}`);
    }
  }

  private async setTags(characterId: string, tags: string[]) {
    await this.db.from('character_tags').delete().eq('character_id', characterId);
    const uniq = [...new Map(tags.map((t) => [slugifyTag(t), t.trim()])).entries()].filter(([slug]) => slug);
    if (!uniq.length) return;
    const rows = must(
      await this.db
        .from('tags')
        .upsert(uniq.map(([slug, name]) => ({ slug, name: name.slice(0, 30) })), { onConflict: 'slug', ignoreDuplicates: false })
        .select('id'),
      'tags',
    ) as { id: string }[];
    await this.db.from('character_tags').insert(rows.map((r) => ({ character_id: characterId, tag_id: r.id })));
  }

  private async newVersion(characterId: string, version: number, sheet: CharacterSheet, userId: string, note?: string) {
    const v = must(
      await this.db
        .from('character_versions')
        .insert({ character_id: characterId, version, sheet, created_by: userId, note: note ?? '' })
        .select('id')
        .single(),
      'version',
    ) as { id: string };
    return v.id;
  }

  private derived(sheet: CharacterSheet, tags: string[], username = '') {
    return {
      name: sheet.name,
      tagline: truncate(sheet.tagline || '', 160),
      description: truncate(sheet.biography || sheet.personality || '', 800),
      greeting_preview: truncate(sheet.firstMessage || '', 400),
      voice: sheet.voice ?? null,
      search_text: truncate([tags.join(' '), sheet.universe, sheet.personality, sheet.scenario, username].filter(Boolean).join(' '), 4000),
    };
  }

/** Private characters per plan (public and unlisted ones are unlimited). */
  private async assertPrivateRoom(userId: string, excludeId?: string) {
    const user = await this.repo.user(userId);
    const max = PLAN_LIMITS[user.isPremium ? 'premium' : 'free'].privateCharacters;
    let q = this.db.from('characters').select('id', { count: 'exact', head: true }).eq('creator_id', userId).eq('visibility', 'private').neq('kind', 'member').neq('status', 'removed');
    if (excludeId) q = q.neq('id', excludeId);
    const { count } = await q;
    if ((count ?? 0) >= max) {
      throw new AppError(403, 'plan_limit', `Você chegou ao limite de ${max} personagens privados do seu plano. Publique ou apague algum, ou entre na lista do Premium.`);
    }
  }

    async create(userId: string, raw: CharacterUpsert) {
    const input = characterUpsertSchema.parse(raw);
    if (input.kind === 'group' && input.members.length < 2) throw badRequest('Um grupo precisa de pelo menos 2 integrantes.');
    if (input.visibility === 'private') await this.assertPrivateRoom(userId);
    await this.moderate(userId, input);
    const profile = must(await this.db.from('user_profiles').select('username').eq('id', userId).single(), 'profile') as { username: string };

    const row = must(
      await this.db
        .from('characters')
        .insert({
          creator_id: userId,
          kind: input.kind,
          avatar_path: input.avatarPath ?? null,
          visibility: input.visibility,
          maturity: input.maturity,
          category_slug: input.categorySlug ?? null,
          published_at: input.visibility === 'public' ? new Date().toISOString() : null,
          ...this.derived(input.sheet, input.tags, profile.username),
        })
        .select('id')
        .single(),
      'create character',
    ) as { id: string };

    const versionId = await this.newVersion(row.id, 1, input.sheet, userId, input.versionNote ?? 'Versão inicial');
    await this.db.from('characters').update({ current_version_id: versionId, current_version: 1 }).eq('id', row.id);
    await this.setTags(row.id, input.tags);
    await this.setImages(row.id, input.avatarPath ?? null, input.imagePaths);
    if (input.kind === 'group') {
      await this.db.from('character_groups').insert({ character_id: row.id });
      await this.syncMembers(row.id, userId, input.members);
    }
    await this.repo.enqueue('embed_character', { characterId: row.id }, `embedc:${row.id}`, 1);
    return { id: row.id };
  }

  async update(userId: string, id: string, raw: CharacterUpsert) {
    const existing = await this.repo.character(id);
    if (existing.creator_id !== userId) throw forbidden();
    if (existing.kind === 'member') throw badRequest('Edite o grupo para alterar integrantes.');
    const input = characterUpsertSchema.parse({ ...raw, kind: existing.kind });
    if (existing.kind === 'group' && input.members.length < 2) throw badRequest('Um grupo precisa de pelo menos 2 integrantes.');
    await this.moderate(userId, input, id);
    if (input.visibility === 'private' && existing.visibility !== 'private') await this.assertPrivateRoom(userId, id);
    const profile = must(await this.db.from('user_profiles').select('username').eq('id', userId).single(), 'profile') as { username: string };

    let versionId = existing.current_version_id;
    let version = existing.current_version;
    if (diffSheets(existing.sheet, input.sheet).length || !versionId) {
      version += 1;
      versionId = await this.newVersion(id, version, input.sheet, userId, input.versionNote);
    }
    must(
      await this.db
        .from('characters')
        .update({
          avatar_path: input.avatarPath ?? null,
          visibility: input.visibility,
          maturity: input.maturity,
          category_slug: input.categorySlug ?? null,
          current_version_id: versionId,
          current_version: version,
          published_at: input.visibility === 'public' ? (existing.visibility === 'public' ? undefined : new Date().toISOString()) : null,
          ...this.derived(input.sheet, input.tags, profile.username),
        })
        .eq('id', id),
      'update character',
    );
    await this.setTags(id, input.tags);
    await this.setImages(id, input.avatarPath ?? null, input.imagePaths);
    if (existing.kind === 'group') await this.syncMembers(id, userId, input.members);
    await this.repo.enqueue('embed_character', { characterId: id }, `embedc:${id}`, 1);
    return { id, version };
  }

  async restoreVersion(userId: string, id: string, versionId: string) {
    const existing = await this.repo.character(id);
    if (existing.creator_id !== userId) throw forbidden();
    const v = must(await this.db.from('character_versions').select('sheet, version').eq('id', versionId).eq('character_id', id).maybeSingle(), 'version') as
      | { sheet: CharacterSheet; version: number }
      | null;
    if (!v) throw notFound('Versão');
    const version = existing.current_version + 1;
    const newId = await this.newVersion(id, version, v.sheet, userId, `Restaurada da versão ${v.version}`);
    await this.db
      .from('characters')
      .update({ current_version_id: newId, current_version: version, ...this.derived(v.sheet, []) , search_text: undefined })
      .eq('id', id);
    return { id, version };
  }

  /**
   * Removes a character. If other people have conversations with it, it is
   * unpublished instead, so their stories are not destroyed.
   */
  async remove(userId: string, id: string) {
    const existing = await this.repo.character(id);
    if (existing.creator_id !== userId) throw forbidden();
    const { count } = await this.db.from('conversations').select('id', { count: 'exact', head: true }).eq('character_id', id).neq('user_id', userId);
    if ((count ?? 0) > 0) {
      await this.db.from('characters').update({ status: 'removed', visibility: 'private', published_at: null }).eq('id', id);
      return { removed: 'unpublished' as const };
    }
    await this.db.from('characters').delete().eq('id', id);
    return { removed: 'deleted' as const };
  }

  private async setImages(characterId: string, avatar: string | null, gallery: string[]) {
    await this.db.from('character_images').delete().eq('character_id', characterId);
    const rows = [
      ...(avatar ? [{ character_id: characterId, path: avatar, kind: 'avatar', position: 0 }] : []),
      ...gallery.map((path, i) => ({ character_id: characterId, path, kind: 'gallery', position: i + 1 })),
    ];
    if (rows.length) await this.db.from('character_images').insert(rows);
  }

  private async syncMembers(groupId: string, userId: string, members: ReturnType<typeof characterUpsertSchema.parse>['members']) {
    const current = (must(await this.db.from('group_members').select('member_id').eq('group_id', groupId), 'members') as { member_id: string }[]).map((r) => r.member_id);
    const keep = new Set<string>();
    for (let i = 0; i < members.length; i++) {
      const m = members[i];
      if (m.id && current.includes(m.id)) {
        keep.add(m.id);
        const existing = await this.repo.character(m.id);
        let versionId = existing.current_version_id;
        let version = existing.current_version;
        if (diffSheets(existing.sheet, m.sheet).length || !versionId) {
          version += 1;
          versionId = await this.newVersion(m.id, version, m.sheet, userId);
        }
        await this.db
          .from('characters')
          .update({ name: m.sheet.name, tagline: truncate(m.sheet.tagline || '', 160), avatar_path: m.avatarPath ?? null, current_version_id: versionId, current_version: version })
          .eq('id', m.id);
        await this.db.from('group_members').update({ position: i }).eq('group_id', groupId).eq('member_id', m.id);
      } else {
        const row = must(
          await this.db
            .from('characters')
            .insert({ creator_id: userId, kind: 'member', parent_group_id: groupId, name: m.sheet.name, tagline: truncate(m.sheet.tagline || '', 160), avatar_path: m.avatarPath ?? null, visibility: 'private' })
            .select('id')
            .single(),
          'member',
        ) as { id: string };
        const versionId = await this.newVersion(row.id, 1, m.sheet, userId);
        await this.db.from('characters').update({ current_version_id: versionId, current_version: 1 }).eq('id', row.id);
        await this.db.from('group_members').insert({ group_id: groupId, member_id: row.id, position: i });
        keep.add(row.id);
      }
    }
    const removed = current.filter((id) => !keep.has(id));
    if (removed.length) await this.db.from('characters').delete().in('id', removed);
  }

  /** Embedding of the public description, used for recommendations. */
  async embed(characterId: string) {
    if (!this.ai.hasEmbeddings) return;
    const row = must(await this.db.from('characters').select('id, name, tagline, description, search_text, creator_id').eq('id', characterId).maybeSingle(), 'character') as
      | (Pick<CharacterRow, 'id' | 'name' | 'tagline' | 'description' | 'creator_id'> & { search_text: string })
      | null;
    if (!row) return;
    const vec = await this.ai.embed([[row.name, row.tagline, row.description, row.search_text].join('\n')], { userId: row.creator_id, kind: 'embed_character' });
    if (vec?.[0]) await this.db.from('characters').update({ embedding: toVectorLiteral(vec[0]) }).eq('id', characterId);
  }
}
