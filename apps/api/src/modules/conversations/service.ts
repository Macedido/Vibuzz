import { PLAN_LIMITS, type StreamEvent } from '@vibuzz/shared';
import type { Env } from '../../config';
import { MESSAGE_COLUMNS, must, type CharacterWithSheet, type Db, type ImageAnalysisRef, type MessageRow } from '../../lib/db';
import { AppError, badRequest, blocked, forbidden, notFound } from '../../lib/errors';
import { truncate } from '../../lib/json';
import { assertOwnedPath, type StorageService } from '../../lib/storage';
import type { IntelligenceEngine } from '../intelligence/engine';
import { toApiMessage } from '../intelligence/engine';
import { fillPlaceholders } from '../intelligence/prompts';
import type { MemoryService } from '../memory/service';
import type { ModerationService } from '../moderation/service';
import { analysisToNote, type VisionService } from '../vision/service';
import type { Repo } from './repo';

type Emit = (e: StreamEvent) => void;

export { fillPlaceholders };

export class ConversationService {
  constructor(
    private env: Env,
    private repo: Repo,
    private engine: IntelligenceEngine,
    private memory: MemoryService,
    private moderation: ModerationService,
    private vision: VisionService,
    private storage: StorageService,
  ) {}

  private get db(): Db {
    return this.repo.db;
  }

  /* -------------------------------- access -------------------------------- */

  async assertCanView(character: CharacterWithSheet, viewer: { id: string; isAdult: boolean; allow_mature: boolean }) {
    if (character.creator_id === viewer.id) return;
    if (character.kind === 'member') throw notFound('Personagem');
    if (character.status !== 'active' || character.visibility === 'private') throw notFound('Personagem');
    if (character.maturity === 'mature' && !(viewer.isAdult && viewer.allow_mature)) throw forbidden('Conteúdo adulto indisponível para sua conta.');
    if (await this.repo.isBlockedPair(viewer.id, character.creator_id)) throw notFound('Personagem');
  }

  /** Existing conversations keep working if a creator unpublishes, but age and block rules still apply. */
  async assertCanContinue(character: CharacterWithSheet, viewer: { id: string; isAdult: boolean; allow_mature: boolean }) {
    if (character.creator_id === viewer.id) return;
    if (character.maturity === 'mature' && !(viewer.isAdult && viewer.allow_mature)) throw forbidden('Conteúdo adulto indisponível para sua conta.');
    if (await this.repo.isBlockedPair(viewer.id, character.creator_id)) throw forbidden('Você não pode conversar com este personagem.');
  }

  private async assertQuota(userId: string, premium = false) {
    const { data } = await this.db.rpc('usage_today', { p_user: userId });
    const row = (data as { chat_messages: number; cost_usd: number }[] | null)?.[0];
    if (!row) return;
    const limit = dailyMessageLimit(this.env, premium);
    if (Number(row.chat_messages) >= limit || Number(row.cost_usd) >= this.env.DAILY_COST_LIMIT_USD * (premium ? 5 : 1)) {
      throw new AppError(
        429,
        'daily_limit',
        premium ? 'Você chegou ao limite diário de mensagens. Volta amanhã!' : `Você usou as ${limit} mensagens grátis de hoje. Volta amanhã, ou assine o Premium para ter ${PLAN_LIMITS.premium.messagesPerDay} por dia.`,
      );
    }
  }

  private async assertActive(userId: string) {
    const user = await this.repo.user(userId);
    if (user.status !== 'active') throw forbidden('Conta suspensa.');
    if (!user.birthdate) throw new AppError(403, 'birthdate_required', 'Informe sua data de nascimento para continuar.');
    return user;
  }

  /* ------------------------------- lifecycle ------------------------------ */

  async create(userId: string, characterId: string, personaId?: string | null) {
    const user = await this.assertActive(userId);
    const character = await this.repo.character(characterId);
    await this.assertCanView(character, user);
    const persona = personaId ? await this.repo.persona(personaId, userId) : null;
    if (personaId && !persona) throw badRequest('Persona inválida.');

    const conv = must(
      await this.db
        .from('conversations')
        .insert({ user_id: userId, character_id: characterId, persona_id: persona?.id ?? null, title: character.name })
        .select('id')
        .single(),
      'create conversation',
    ) as { id: string };

    const members = character.kind === 'group' ? await this.repo.groupCast(character.id) : [];
    const participantIds = members.length ? members.map((m) => m.id) : [character.id];
    await this.db.from('conversation_members').insert(participantIds.map((id) => ({ conversation_id: conv.id, character_id: id })));

    const greeting = fillPlaceholders(character.sheet.firstMessage ?? '', persona?.name ?? 'você', character.name).trim();
    if (greeting) {
      const msg = must(
        await this.db
          .from('messages')
          .insert({ conversation_id: conv.id, role: 'assistant', speaker_character_id: character.id, content: greeting, depth: 0 })
          .select('id')
          .single(),
        'greeting',
      ) as { id: string };
      await this.db.from('conversations').update({ active_leaf_id: msg.id, last_message_preview: truncate(greeting, 140) }).eq('id', conv.id);
    }
    return { id: conv.id };
  }

  /* --------------------------------- send --------------------------------- */

  async send(
    userId: string,
    conversationId: string,
    input: { content: string; imagePaths: string[]; parentId?: string | null; privateToCharacterId?: string | null },
    emit: Emit,
    signal: AbortSignal,
  ) {
    const user = await this.assertActive(userId);
    const conv = await this.repo.conversation(conversationId, userId);
    const character = await this.repo.character(conv.character_id);
    await this.assertCanContinue(character, user);
    await this.assertQuota(userId, user.isPremium);

    const content = input.content.trim();
    if (!content && !input.imagePaths.length) throw badRequest('Mensagem vazia.');
    for (const p of input.imagePaths) assertOwnedPath(p, userId);

    let privateTo: string | null = null;
    if (input.privateToCharacterId) {
      if (character.kind !== 'group') throw badRequest('Mensagens privadas só existem em grupos.');
      const cast = await this.repo.groupCast(character.id);
      if (!cast.some((c) => c.id === input.privateToCharacterId)) throw badRequest('Integrante inválido.');
      privateTo = input.privateToCharacterId;
    }

    const verdict = content ? await this.moderation.checkText(content, 'chat', { userId, conversationId, kind: 'moderation_chat', targetType: 'message' }) : null;
    if (verdict && !verdict.allowed) throw blocked(verdict.reason);

    const analyses: ImageAnalysisRef[] = [];
    for (const path of input.imagePaths) {
      const img = await this.storage.downloadForModel('chat', path);
      if (!img) throw badRequest('Imagem muito grande (máx. 4 MB).');
      const v = await this.moderation.checkImage(img, 'image_chat', { userId, conversationId, kind: 'moderation_image', targetType: 'message' });
      if (!v.allowed) throw blocked(`Imagem não permitida: ${v.reason}`);
      try {
        const a = await this.vision.analyze(img, { userId, conversationId, kind: 'vision' }, 'chat');
        analyses.push({ path, summary: analysisToNote(a), kind: a.kind });
      } catch {
        // Vision unavailable (e.g. free models busy): keep the message, note the image.
        analyses.push({ path, summary: 'O usuário enviou uma imagem que não pôde ser descrita automaticamente; pergunte o que ela mostra se for relevante.', kind: 'unknown' });
      }
    }

    const parentId = input.parentId ?? conv.active_leaf_id;
    let depth = 0;
    if (parentId) {
      const parent = await this.repo.message(parentId);
      if (parent.conversation_id !== conv.id) throw badRequest('Mensagem pai inválida.');
      depth = parent.depth + 1;
    }

    const userMsg = must(
      await this.db
        .from('messages')
        .insert({
          conversation_id: conv.id,
          parent_id: parentId,
          depth,
          role: 'user',
          persona_id: conv.persona_id,
          audience_character_id: privateTo,
          content,
          image_paths: input.imagePaths,
          image_analyses: analyses.length ? analyses : null,
        })
        .select(MESSAGE_COLUMNS)
        .single(),
      'insert message',
    ) as MessageRow;
    await this.db
      .from('conversations')
      .update({ active_leaf_id: userMsg.id, last_message_at: new Date().toISOString(), last_message_preview: truncate(content || '📷 Imagem', 140) })
      .eq('id', conv.id);
    emit({ type: 'user_message', message: toApiMessage(userMsg) });

    await this.engine.runTurn({
      conversation: { ...conv, active_leaf_id: userMsg.id },
      viewer: { id: userId, isAdult: user.isAdult, allowMature: user.allow_mature, isPremium: user.isPremium },
      parentId: userMsg.id,
      crisis: verdict?.crisis,
      privateTo,
      emit,
      signal,
    });
  }

  /* ------------------------------ regenerate ------------------------------ */

  async regenerate(userId: string, conversationId: string, messageId: string, emit: Emit, signal: AbortSignal) {
    const user = await this.assertActive(userId);
    const conv = await this.repo.conversation(conversationId, userId);
    await this.assertCanContinue(await this.repo.character(conv.character_id), user);
    await this.assertQuota(userId, user.isPremium);
    const msg = await this.repo.message(messageId);
    if (msg.conversation_id !== conv.id || msg.deleted_at) throw notFound('Mensagem');
    if (msg.role !== 'assistant' || !msg.parent_id) throw badRequest('Só respostas do personagem podem ser regeneradas.');
    const parent = await this.repo.message(msg.parent_id);
    await this.engine.runTurn({
      conversation: conv,
      viewer: { id: userId, isAdult: user.isAdult, allowMature: user.allow_mature, isPremium: user.isPremium },
      parentId: msg.parent_id,
      privateTo: parent.audience_character_id,
      emit,
      signal,
    });
  }

  async continue(userId: string, conversationId: string, emit: Emit, signal: AbortSignal) {
    const user = await this.assertActive(userId);
    const conv = await this.repo.conversation(conversationId, userId);
    await this.assertCanContinue(await this.repo.character(conv.character_id), user);
    await this.assertQuota(userId, user.isPremium);
    if (!conv.active_leaf_id) throw badRequest('Nada para continuar.');
    const leaf = await this.repo.message(conv.active_leaf_id);
    if (leaf.role !== 'assistant' || leaf.deleted_at) throw badRequest('A última mensagem não é do personagem.');
    await this.engine.runTurn({
      conversation: conv,
      viewer: { id: userId, isAdult: user.isAdult, allowMature: user.allow_mature, isPremium: user.isPremium },
      parentId: leaf.id,
      continueMessageId: leaf.id,
      emit,
      signal,
    });
  }

  /* --------------------------------- edit --------------------------------- */

  async edit(
    userId: string,
    messageId: string,
    input: { content: string; mode: 'branch' | 'replace'; regenerate: boolean },
    emit: Emit,
    signal: AbortSignal,
  ) {
    const user = await this.assertActive(userId);
    const msg = await this.repo.message(messageId);
    const conv = await this.repo.conversation(msg.conversation_id, userId);
    if (msg.deleted_at) throw notFound('Mensagem');
    await this.assertCanContinue(await this.repo.character(conv.character_id), user);
    const verdict = await this.moderation.checkText(input.content, 'chat', { userId, conversationId: conv.id, kind: 'moderation_chat', targetType: 'message' });
    if (!verdict.allowed) throw blocked(verdict.reason);

    if (input.mode === 'replace') {
      const ids = (must(await this.db.rpc('subtree_ids', { p_message: msg.id }), 'subtree') as string[]) ?? [];
      await this.repo.inChunks(ids, (c) =>
        this.db.from('messages').update({ deleted_at: new Date().toISOString(), hidden_reason: 'replaced' }).in('id', c).is('deleted_at', null),
      );
      await this.memory.invalidateForMessages(ids, { purge: false });
    }

    const edited = must(
      await this.db
        .from('messages')
        .insert({
          conversation_id: conv.id,
          parent_id: msg.parent_id,
          depth: msg.depth,
          role: msg.role,
          speaker_character_id: msg.speaker_character_id,
          persona_id: msg.persona_id,
          audience_character_id: msg.audience_character_id,
          content: input.content.trim(),
          image_paths: msg.image_paths,
          image_analyses: msg.image_analyses,
          edited_from_id: msg.id,
        })
        .select(MESSAGE_COLUMNS)
        .single(),
      'edit message',
    ) as MessageRow;
    if (input.mode === 'branch') {
      await this.db.from('message_branches').insert({ conversation_id: conv.id, fork_parent_id: msg.parent_id, first_message_id: edited.id, label: 'Edição' });
    }
    await this.db.from('conversations').update({ active_leaf_id: edited.id, last_message_preview: truncate(edited.content, 140) }).eq('id', conv.id);
    emit({ type: 'user_message', message: toApiMessage(edited) });

    if (edited.role === 'user' && input.regenerate) {
      await this.assertQuota(userId, user.isPremium);
      await this.engine.runTurn({
        conversation: { ...conv, active_leaf_id: edited.id },
        viewer: { id: userId, isAdult: user.isAdult, allowMature: user.allow_mature, isPremium: user.isPremium },
        parentId: edited.id,
        crisis: verdict.crisis,
        privateTo: edited.audience_character_id,
        emit,
        signal,
      });
    } else {
      await this.repo.enqueue('consolidate_memory', { conversationId: conv.id }, `mem:${conv.id}`, 20);
    }
  }

  /* -------------------------------- delete -------------------------------- */

  /**
   * hide (default): removed from the active history, the UI and the AI context;
   *   derived memories invalidated; content erased after MESSAGE_PURGE_DAYS.
   * purge: content and derived memories erased immediately.
   */
  async deleteMessage(userId: string, messageId: string, purge: boolean) {
    const msg = await this.repo.message(messageId);
    const conv = await this.repo.conversation(msg.conversation_id, userId);
    if (!msg.deleted_at) {
      await this.db.from('messages').update({ deleted_at: new Date().toISOString(), hidden_reason: 'deleted' }).eq('id', msg.id);
    }
    await this.memory.invalidateForMessages([msg.id], { purge });
    if (purge) await this.purgeMessages([msg.id]);

    if (conv.active_leaf_id === msg.id) {
      const { count } = await this.db.from('messages').select('id', { count: 'exact', head: true }).eq('parent_id', msg.id).is('deleted_at', null);
      if (!count) {
        // Move the leaf to the nearest visible ancestor.
        const path = await this.repo.pathMessages(msg.parent_id);
        const leaf = path[path.length - 1]?.id ?? null;
        await this.db
          .from('conversations')
          .update({ active_leaf_id: leaf, last_message_preview: truncate(path[path.length - 1]?.content ?? '', 140) })
          .eq('id', conv.id);
      }
    }
    return { deleted: true, purged: purge };
  }

  async purgeMessages(ids: string[]) {
    const rows = (must(await this.db.from('messages').select('id, image_paths').in('id', ids), 'purge') as { id: string; image_paths: string[] }[]) ?? [];
    await this.storage.remove('chat', rows.flatMap((r) => r.image_paths ?? []));
    await this.db
      .from('messages')
      .update({ content: '', image_paths: [], image_analyses: null, scene_state: null, purged_at: new Date().toISOString() })
      .in('id', ids);
  }

  /* -------------------------------- branches ------------------------------ */

  async switchBranch(userId: string, messageId: string) {
    const msg = await this.repo.message(messageId);
    const conv = await this.repo.conversation(msg.conversation_id, userId);
    if (msg.deleted_at) throw notFound('Mensagem');
    const leaf = must(await this.db.rpc('deepest_leaf', { p_message: msg.id }), 'leaf') as string;
    const leafMsg = await this.repo.message(leaf);
    await this.db.from('conversations').update({ active_leaf_id: leaf, last_message_preview: truncate(leafMsg.content, 140) }).eq('id', conv.id);
    return { leafId: leaf };
  }

  async maintenancePurge() {
    const cutoff = new Date(Date.now() - this.env.MESSAGE_PURGE_DAYS * 86400_000).toISOString();
    const rows = (must(
      await this.db.from('messages').select('id').not('deleted_at', 'is', null).is('purged_at', null).lt('deleted_at', cutoff).limit(200),
      'old deleted',
    ) as { id: string }[]) ?? [];
    if (!rows.length) return 0;
    const ids = rows.map((r) => r.id);
    await this.memory.invalidateForMessages(ids, { purge: true });
    await this.purgeMessages(ids);
    return ids.length;
  }
}

/** Free plan limit comes from DAILY_MESSAGE_LIMIT (default 200); Premium from PLAN_LIMITS. */
export function dailyMessageLimit(env: { DAILY_MESSAGE_LIMIT: number }, premium: boolean): number {
  return premium ? Math.max(PLAN_LIMITS.premium.messagesPerDay, env.DAILY_MESSAGE_LIMIT) : env.DAILY_MESSAGE_LIMIT;
}
