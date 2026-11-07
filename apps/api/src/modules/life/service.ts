import { PLAN_LIMITS } from '@vibuzz/shared';
import { truncate } from '../../lib/json';
import type { Logger } from '../../lib/log';
import type { Repo } from '../conversations/repo';
import type { IntelligenceEngine } from '../intelligence/engine';
import type { PushService } from '../push/service';

/** "há 3 horas", "desde ontem"… for the prompt. */
export function idleText(lastAt: string | Date, now = new Date()): string {
  const h = Math.max(0, (now.getTime() - new Date(lastAt).getTime()) / 3_600_000);
  if (h < 1.5) return 'cerca de uma hora';
  if (h < 20) return `umas ${Math.round(h)} horas`;
  if (h < 40) return 'desde ontem';
  return `${Math.round(h / 24)} dias`;
}

/**
 * Characters with a life of their own: when the user allows it, a character writes
 * first after some time (the schedule lives in the database), sometimes with a photo,
 * and the user gets a notification.
 */
export class LifeService {
  constructor(
    private repo: Repo,
    private engine: IntelligenceEngine,
    private push: PushService,
    private log: Logger,
    private appUrl: string,
  ) {}

  private get db() {
    return this.repo.db;
  }

  async runDue(limit = 3, budgetMs = 40_000): Promise<number> {
    const started = Date.now();
    const { data, error } = await this.db.rpc('claim_proactive', { p_limit: limit });
    if (error) {
      this.log.warn({ err: error.message }, 'claim_proactive failed');
      return 0;
    }
    const ids = ((data ?? []) as (string | { claim_proactive: string })[]).map((r) => (typeof r === 'string' ? r : r.claim_proactive));
    let sent = 0;
    for (const id of ids) {
      if (Date.now() - started > budgetMs) break;
      try {
        if (await this.runOne(id)) sent++;
      } catch (e) {
        this.log.warn({ err: (e as Error).message, conversationId: id }, 'proactive message failed');
      }
    }
    return sent;
  }

  /** Writes one spontaneous message in a conversation. Returns false when skipped. */
  async runOne(conversationId: string): Promise<boolean> {
    const conv = await this.repo.conversation(conversationId);
    if (!conv.active_leaf_id || !conv.proactive_mode || conv.proactive_mode === 'off') return false;
    const user = await this.repo.user(conv.user_id);
    if (user.status !== 'active' || !user.birthdate || !user.spontaneous_messages) return false;

    const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
    const { count } = await this.db
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conv.id)
      .eq('is_spontaneous', true)
      .gte('created_at', since);
    const cap = PLAN_LIMITS[user.isPremium ? 'premium' : 'free'].proactivePerDay[conv.proactive_mode];
    if ((count ?? 0) >= cap) return false;

    // Never two spontaneous messages in a row without the user answering.
    const leaf = await this.repo.message(conv.active_leaf_id);
    if (leaf.is_spontaneous) return false;

    const { data: convRow } = await this.db.from('conversations').select('last_message_at').eq('id', conv.id).single();
    const created = await this.engine.runTurn({
      conversation: conv,
      viewer: { id: user.id, isAdult: user.isAdult, allowMature: user.allow_mature, isPremium: user.isPremium },
      parentId: conv.active_leaf_id,
      proactive: { idle: idleText((convRow as { last_message_at: string } | null)?.last_message_at ?? leaf.created_at) },
      emit: () => {},
      signal: new AbortController().signal,
    });
    const last = created[created.length - 1];
    if (!last) return false;

    const character = await this.repo.character(conv.character_id);
    const speaker = last.speaker_character_id && last.speaker_character_id !== character.id ? await this.repo.character(last.speaker_character_id).catch(() => character) : character;
    const preview = last.image_paths?.length && !last.content ? '📷 Foto' : truncate(last.content.replace(/\*[^*]*\*/g, '').trim() || last.content, 140);
    await this.db.from('notifications').insert({
      user_id: conv.user_id,
      type: 'message',
      payload: { conversationId: conv.id, characterId: speaker.id, name: speaker.name, preview, photo: Boolean(last.image_paths?.length) },
    });
    const icon = speaker.avatar_path ? `${this.appUrl.replace(/\/$/, '')}/storage/v1/object/public/media/${speaker.avatar_path}` : null;
    await this.push.sendToUser(conv.user_id, { title: speaker.name, body: preview, url: `/chat/${conv.id}`, icon, tag: `chat-${conv.id}` });
    return true;
  }
}
