import { ageFromBirthdate, ADULT_AGE, characterSheetSchema, emptySheet } from '@vibuzz/shared';
import { MESSAGE_COLUMNS, must, type CharacterRow, type CharacterWithSheet, type ConversationRow, type Db, type MessageRow, type PersonaRow, type UserRow } from '../../lib/db';
import { notFound } from '../../lib/errors';

const CHARACTER_COLUMNS =
  'id, creator_id, kind, parent_group_id, name, tagline, description, avatar_path, visibility, maturity, category_slug, current_version_id, current_version, status';

/** Data access shared by the engine, memory jobs and routes (service role). */
export class Repo {
  /** immediateJobs: serverless runtimes run jobs right after the request instead of batching with delays. */
  constructor(
    readonly db: Db,
    private opts: { immediateJobs?: boolean } = {},
  ) {}

  async user(id: string): Promise<UserRow & { isAdult: boolean }> {
    const row = must(await this.db.from('users').select('id, birthdate, allow_mature, role, status').eq('id', id).maybeSingle(), 'user') as UserRow | null;
    if (!row) throw notFound('Usuário');
    return { ...row, isAdult: ageFromBirthdate(row.birthdate) >= ADULT_AGE };
  }

  async conversation(id: string, userId?: string): Promise<ConversationRow> {
    let q = this.db.from('conversations').select('id, user_id, character_id, persona_id, title, active_leaf_id, creativity, is_archived').eq('id', id);
    if (userId) q = q.eq('user_id', userId);
    const row = must(await q.maybeSingle(), 'conversation') as ConversationRow | null;
    if (!row) throw notFound('Conversa');
    return row;
  }

  async character(id: string): Promise<CharacterWithSheet> {
    const row = must(await this.db.from('characters').select(CHARACTER_COLUMNS).eq('id', id).maybeSingle(), 'character') as CharacterRow | null;
    if (!row) throw notFound('Personagem');
    return { ...row, sheet: await this.sheet(row) };
  }

  async sheet(row: Pick<CharacterRow, 'current_version_id' | 'name'>) {
    if (!row.current_version_id) return emptySheet(row.name);
    const v = must(await this.db.from('character_versions').select('sheet').eq('id', row.current_version_id).maybeSingle(), 'version') as { sheet: unknown } | null;
    const parsed = characterSheetSchema.safeParse(v?.sheet ?? {});
    return parsed.success ? parsed.data : emptySheet(row.name);
  }

  /** Members of a group character, ordered, with their sheets. */
  async groupCast(groupId: string): Promise<CharacterWithSheet[]> {
    const rows = must(
      await this.db.from('group_members').select('position, member:characters!group_members_member_id_fkey(' + CHARACTER_COLUMNS + ')').eq('group_id', groupId).order('position'),
      'group members',
    ) as unknown as { member: CharacterRow }[];
    return Promise.all(rows.filter((r) => r.member).map(async (r) => ({ ...r.member, sheet: await this.sheet(r.member) })));
  }

  async persona(id: string | null, ownerId: string): Promise<PersonaRow | null> {
    if (!id) return null;
    return must(await this.db.from('personas').select('*').eq('id', id).eq('owner_id', ownerId).maybeSingle(), 'persona') as PersonaRow | null;
  }

  async message(id: string): Promise<MessageRow> {
    const row = must(await this.db.from('messages').select(MESSAGE_COLUMNS).eq('id', id).maybeSingle(), 'message') as MessageRow | null;
    if (!row) throw notFound('Mensagem');
    return row;
  }

  /** Ancestor ids root→leaf (including deleted ones; callers filter). */
  async pathIds(leafId: string | null): Promise<string[]> {
    if (!leafId) return [];
    return (must(await this.db.rpc('message_path_ids', { p_leaf: leafId }), 'path') as string[]) ?? [];
  }

  /** Visible messages on the path to a leaf, root first. */
  async pathMessages(leafId: string | null): Promise<MessageRow[]> {
    if (!leafId) return [];
    const rows = (must(await this.db.rpc('path_messages', { p_leaf: leafId }), 'path messages') as MessageRow[]) ?? [];
    return rows.filter((m) => !m.deleted_at);
  }

  /** Runs an update/delete over a long id list without exceeding URL limits. */
  async inChunks(ids: string[], fn: (chunk: string[]) => PromiseLike<unknown>, size = 80) {
    for (let i = 0; i < ids.length; i += size) await fn(ids.slice(i, i + size));
  }

  /** True when either user blocked the other. */
  async isBlockedPair(a: string, b: string): Promise<boolean> {
    if (a === b) return false;
    const { data } = await this.db
      .from('blocks')
      .select('blocker_id')
      .or(`and(blocker_id.eq.${a},blocked_id.eq.${b}),and(blocker_id.eq.${b},blocked_id.eq.${a})`)
      .limit(1);
    return Boolean(data?.length);
  }

  async enqueue(type: string, payload: Record<string, unknown>, dedupeKey?: string, delaySeconds = 0) {
    const delay = this.opts.immediateJobs ? 0 : delaySeconds;
    await this.db.rpc('enqueue_job', { p_type: type, p_payload: payload, p_dedupe_key: dedupeKey ?? null, p_delay_seconds: delay });
  }
}
