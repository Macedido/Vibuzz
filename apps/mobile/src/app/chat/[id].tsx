import type { StreamEvent } from '@vibuzz/shared';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RoleplayText } from '@/components/rich-text';
import {
  ActionSheet,
  Avatar,
  Banner,
  Button,
  Chip,
  ChipScroller,
  ErrorState,
  IconButton,
  Ionicons,
  Loading,
  Panel,
  Row,
  Segmented,
  type SheetAction,
} from '@/components/ui';
import { api, errorMessage, stream } from '@/lib/api';
import { unwrap } from '@/lib/hooks';
import { chatImageUrl, supabase } from '@/lib/supabase';
import { colors, radius, space, type } from '@/lib/theme';
import type { Persona, PathMessage } from '@/lib/types';
import { pickImage, uploadImage, type PickedImage } from '@/lib/upload';

interface Meta {
  conversation: { id: string; title: string; character_id: string; persona_id: string | null; creativity: number; is_favorite: boolean; is_archived: boolean };
  character: { id: string; name: string; avatar_path: string | null; kind: string } | null;
  members: { id: string; name: string; avatar_path: string | null }[];
  personas: Persona[];
}

interface UiMessage extends PathMessage {
  streaming?: boolean;
  failed?: boolean;
  localImages?: string[];
}

const CREATIVITY = [
  { value: '0.2', label: 'Focado' },
  { value: '0.5', label: 'Equilibrado' },
  { value: '0.8', label: 'Criativo' },
  { value: '1', label: 'Ousado' },
] as const;

function ChatImage({ path, local }: { path?: string; local?: string }) {
  const [uri, setUri] = useState<string | null>(local ?? null);
  useEffect(() => {
    if (!local && path) void chatImageUrl(path).then(setUri);
  }, [path, local]);
  if (!uri) return <View style={[styles.chatImage, { backgroundColor: colors.overlay }]} />;
  return <Image source={{ uri }} style={styles.chatImage} contentFit="cover" />;
}

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [images, setImages] = useState<PickedImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [typingName, setTypingName] = useState<string | null>(null);
  const [audience, setAudience] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<UiMessage | null>(null);
  const [editing, setEditing] = useState<UiMessage | null>(null);
  const [editText, setEditText] = useState('');
  const [editMode, setEditMode] = useState<'branch' | 'replace'>('branch');
  const [settings, setSettings] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<{ id: string; role: string; content: string }[]>([]);
  const [deleting, setDeleting] = useState<UiMessage | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<FlatList<UiMessage>>(null);

  const names = useMemo(() => {
    const m = new Map<string, { name: string; avatar: string | null }>();
    if (meta?.character) m.set(meta.character.id, { name: meta.character.name, avatar: meta.character.avatar_path });
    meta?.members.forEach((x) => m.set(x.id, { name: x.name, avatar: x.avatar_path }));
    return m;
  }, [meta]);
  const isGroup = meta?.character?.kind === 'group';
  const persona = meta?.personas.find((p) => p.id === meta.conversation.persona_id) ?? null;

  const loadPath = useCallback(async () => {
    const rows = unwrap(await supabase.rpc('conversation_path', { p_conversation: id })) as PathMessage[];
    setMessages(rows ?? []);
  }, [id]);

  const loadAll = useCallback(async () => {
    setLoadError(null);
    try {
      const conv = unwrap(
        await supabase.from('conversations').select('id, title, character_id, persona_id, creativity, is_favorite, is_archived').eq('id', id).maybeSingle(),
      ) as Meta['conversation'] | null;
      if (!conv) throw new Error('Conversa não encontrada.');
      const [character, members, personas] = await Promise.all([
        supabase.from('characters').select('id, name, avatar_path, kind').eq('id', conv.character_id).maybeSingle(),
        supabase.from('conversation_members').select('character:characters(id, name, avatar_path)').eq('conversation_id', id),
        supabase.from('personas').select('*').order('created_at'),
      ]);
      setMeta({
        conversation: conv,
        character: (character.data as Meta['character']) ?? null,
        members: ((members.data as unknown as { character: Meta['members'][number] | null }[]) ?? []).map((m) => m.character).filter(Boolean) as Meta['members'],
        personas: (personas.data as Persona[]) ?? [],
      });
      await loadPath();
    } catch (e) {
      setLoadError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [id, loadPath]);

  useEffect(() => {
    void loadAll();
    return () => abortRef.current?.abort();
  }, [loadAll]);

  /* ----------------------------- streaming ------------------------------ */

  const handleEvent = useCallback(
    (e: StreamEvent, tempUserId?: string) => {
      switch (e.type) {
        case 'user_message':
          setMessages((prev) => {
            const filtered = tempUserId ? prev.filter((m) => m.id !== tempUserId) : prev;
            const local = prev.find((m) => m.id === tempUserId)?.localImages;
            return [...filtered, { ...e.message, audience_character_id: null, depth: 0, persona_id: null, sibling_ids: [e.message.id], localImages: local }];
          });
          break;
        case 'speaker':
          setTypingName(e.name);
          setMessages((prev) =>
            prev.some((m) => m.id === e.messageId)
              ? prev.map((m) => (m.id === e.messageId ? { ...m, streaming: true } : m))
              : [
                  ...prev,
                  {
                    id: e.messageId,
                    parent_id: prev[prev.length - 1]?.id ?? null,
                    depth: 0,
                    role: 'assistant',
                    speaker_character_id: e.characterId,
                    persona_id: null,
                    audience_character_id: null,
                    content: '',
                    image_paths: [],
                    status: 'streaming',
                    is_pinned: false,
                    created_at: new Date().toISOString(),
                    sibling_ids: [e.messageId],
                    streaming: true,
                  },
                ],
          );
          break;
        case 'delta':
          setTypingName(null);
          setMessages((prev) => prev.map((m) => (m.id === e.messageId ? { ...m, content: m.content + e.text } : m)));
          break;
        case 'message_done':
          setMessages((prev) => prev.map((m) => (m.id === e.message.id ? { ...m, ...e.message, streaming: false } : m)));
          break;
        case 'error':
          setError(e.message);
          break;
      }
    },
    [],
  );

  const run = useCallback(
    async (path: string, body: unknown, tempUserId?: string) => {
      setBusy(true);
      setError(null);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        await stream(path, body, (e) => handleEvent(e, tempUserId), ctrl.signal);
      } catch (e) {
        if ((e as { code?: string }).code !== 'aborted') setError(errorMessage(e));
        if (tempUserId) setMessages((prev) => prev.map((m) => (m.id === tempUserId ? { ...m, failed: true } : m)));
      } finally {
        setBusy(false);
        setTypingName(null);
        abortRef.current = null;
        // Re-sync with the server: ids, siblings and branch state.
        await loadPath().catch(() => {});
      }
    },
    [handleEvent, loadPath],
  );

  const send = async () => {
    const content = text.trim();
    if ((!content && !images.length) || busy) return;
    void Haptics.selectionAsync().catch(() => {});
    const picked = images;
    setText('');
    setImages([]);
    const tempId = `temp-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      {
        id: tempId,
        parent_id: prev[prev.length - 1]?.id ?? null,
        depth: 0,
        role: 'user',
        speaker_character_id: null,
        persona_id: null,
        audience_character_id: audience,
        content,
        image_paths: [],
        status: 'complete',
        is_pinned: false,
        created_at: new Date().toISOString(),
        sibling_ids: [tempId],
        localImages: picked.map((p) => p.uri),
      },
    ]);
    let imagePaths: string[] = [];
    try {
      imagePaths = await Promise.all(picked.map((img) => uploadImage('chat', id, img)));
    } catch (e) {
      setError(errorMessage(e));
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, failed: true } : m)));
      return;
    }
    await run(`/v1/conversations/${id}/messages`, { content, imagePaths, privateToCharacterId: audience }, tempId);
  };

  const stop = () => abortRef.current?.abort();

  /* ------------------------------ actions ------------------------------- */

  const switchTo = async (messageId: string) => {
    try {
      await api(`/v1/messages/${messageId}/switch`, { body: {} });
      await loadPath();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const togglePin = async (m: UiMessage) => {
    setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, is_pinned: !m.is_pinned } : x)));
    await supabase.from('messages').update({ is_pinned: !m.is_pinned }).eq('id', m.id);
  };

  const remove = async (m: UiMessage, purge: boolean) => {
    try {
      await api(`/v1/messages/${m.id}?purge=${purge ? 1 : 0}`, { method: 'DELETE' });
      await loadPath();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const submitEdit = async () => {
    if (!editing || !editText.trim()) return;
    const target = editing;
    setEditing(null);
    // Show the edited version immediately, trimming what comes after it on screen.
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === target.id);
      return idx === -1 ? prev : prev.slice(0, idx);
    });
    await run(`/v1/messages/${target.id}/edit`, { content: editText.trim(), mode: editMode, regenerate: target.role === 'user' });
  };

  const regenerate = async (m: UiMessage) => {
    setMessages((prev) => {
      const idx = prev.findIndex((x) => x.id === m.id);
      return idx === -1 ? prev : prev.slice(0, idx);
    });
    await run(`/v1/conversations/${id}/regenerate`, { messageId: m.id });
  };

  const updateConversation = async (values: Partial<Meta['conversation']>) => {
    setMeta((mt) => mt && { ...mt, conversation: { ...mt.conversation, ...values } });
    const { error } = await supabase.from('conversations').update(values).eq('id', id);
    if (error) setError('Não foi possível salvar a configuração.');
  };

  const runSearch = async () => {
    if (!search.trim()) return;
    const { data } = await supabase.rpc('search_messages', { p_conversation: id, p_query: search.trim() });
    setResults((data as { id: string; role: string; content: string }[]) ?? []);
  };

  const addImage = async () => {
    try {
      const img = await pickImage();
      if (img) setImages((prev) => [...prev, img].slice(0, 4));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  /* ------------------------------- render ------------------------------- */

  if (loading) return <Loading />;
  if (loadError || !meta) return <ErrorState message={loadError ?? 'Erro'} onRetry={loadAll} />;

  const title = meta.character?.name ?? meta.conversation.title;
  const last = messages[messages.length - 1];

  const menuActions = (m: UiMessage): SheetAction[] => {
    const acts: SheetAction[] = [{ label: 'Copiar', icon: 'copy-outline', onPress: () => Clipboard.setStringAsync(m.content) }];
    if (!m.id.startsWith('temp-')) {
      acts.push({ label: 'Editar', icon: 'create-outline', onPress: () => { setEditing(m); setEditText(m.content); setEditMode('branch'); } });
      if (m.role === 'assistant' && m.parent_id) acts.push({ label: 'Regenerar resposta', icon: 'refresh', onPress: () => regenerate(m) });
      if (m.role === 'assistant' && m.id === last?.id) acts.push({ label: 'Continuar resposta', icon: 'play-forward-outline', onPress: () => run(`/v1/conversations/${id}/continue`, {}) });
      acts.push({ label: m.is_pinned ? 'Desafixar' : 'Fixar mensagem', icon: m.is_pinned ? 'pin' : 'pin-outline', onPress: () => togglePin(m) });
      acts.push({ label: 'Apagar…', icon: 'trash-outline', danger: true, onPress: () => setDeleting(m) });
    }
    return acts;
  };

  const renderItem = ({ item: m }: { item: UiMessage }) => {
    const mine = m.role === 'user';
    const speaker = m.speaker_character_id ? names.get(m.speaker_character_id) : null;
    const siblings = m.sibling_ids ?? [m.id];
    const idx = siblings.indexOf(m.id);
    const privateName = m.audience_character_id ? names.get(m.audience_character_id)?.name : null;
    return (
      <View style={[styles.msgRow, mine && { justifyContent: 'flex-end' }]}>
        {!mine ? <Avatar path={speaker?.avatar ?? meta.character?.avatar_path} name={speaker?.name ?? title} size={32} /> : null}
        <View style={{ maxWidth: '82%', alignItems: mine ? 'flex-end' : 'flex-start' }}>
          {!mine && isGroup && speaker ? <Text style={styles.speaker}>{speaker.name}</Text> : null}
          {privateName ? (
            <Row gap={4} style={{ marginBottom: 2 }}>
              <Ionicons name="lock-closed" size={11} color={colors.signal} />
              <Text style={[type.small, { fontSize: 11, color: colors.signal }]}>em particular com {privateName}</Text>
            </Row>
          ) : null}
          <Pressable
            onLongPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              setMenuFor(m);
            }}
            delayLongPress={250}
            style={[styles.bubble, mine ? styles.userBubble : styles.botBubble, m.failed && { borderColor: colors.danger, borderWidth: 1 }]}
          >
            {(m.localImages?.length || m.image_paths?.length) ? (
              <Row style={{ flexWrap: 'wrap', marginBottom: m.content ? space.sm : 0 }} gap={6}>
                {m.localImages?.length ? m.localImages.map((u) => <ChatImage key={u} local={u} />) : m.image_paths.map((p) => <ChatImage key={p} path={p} />)}
              </Row>
            ) : null}
            {m.content ? (
              <RoleplayText text={m.content} style={{ ...type.body, color: mine ? colors.userBubbleText : colors.text }} actionColor={mine ? '#3D4A1A' : colors.muted} />
            ) : m.streaming ? (
              <ActivityIndicator size="small" color={colors.muted} />
            ) : null}
          </Pressable>
          <Row gap={6} style={{ marginTop: 3, paddingHorizontal: 4 }}>
            {m.is_pinned ? <Ionicons name="pin" size={11} color={colors.accent} /> : null}
            {siblings.length > 1 && !m.streaming ? (
              <Row gap={2}>
                <Pressable disabled={idx <= 0 || busy} onPress={() => switchTo(siblings[idx - 1])} hitSlop={8}>
                  <Ionicons name="chevron-back" size={14} color={idx <= 0 ? colors.faint : colors.textSoft} />
                </Pressable>
                <Text style={[type.small, { fontSize: 11 }]}>
                  {idx + 1}/{siblings.length}
                </Text>
                <Pressable disabled={idx >= siblings.length - 1 || busy} onPress={() => switchTo(siblings[idx + 1])} hitSlop={8}>
                  <Ionicons name="chevron-forward" size={14} color={idx >= siblings.length - 1 ? colors.faint : colors.textSoft} />
                </Pressable>
              </Row>
            ) : null}
            {!mine && m.id === last?.id && !busy && !m.streaming && m.parent_id ? (
              <Pressable onPress={() => regenerate(m)} hitSlop={8}>
                <Row gap={3}>
                  <Ionicons name="refresh" size={12} color={colors.muted} />
                  <Text style={[type.small, { fontSize: 11 }]}>Regenerar</Text>
                </Row>
              </Pressable>
            ) : null}
            {m.failed ? <Text style={{ color: colors.danger, fontSize: 11 }}>Não enviada</Text> : null}
          </Row>
        </View>
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <Pressable onPress={() => meta.character && router.push(`/character/${meta.character.id}`)}>
              <Row>
                <Avatar path={meta.character?.avatar_path} name={title} size={30} />
                <View>
                  <Text style={type.h3} numberOfLines={1}>
                    {title}
                  </Text>
                  <Text style={[type.small, { fontSize: 11 }]} numberOfLines={1}>
                    {typingName ? `${typingName} está digitando…` : persona ? `como ${persona.name}` : isGroup ? `${meta.members.length} integrantes` : 'Toque para ver o perfil'}
                  </Text>
                </View>
              </Row>
            </Pressable>
          ),
          headerRight: () => (
            <Row gap={0}>
              <IconButton icon="search" size={20} onPress={() => setSearchOpen(true)} label="Pesquisar" />
              <IconButton icon="options-outline" size={21} onPress={() => setSettings(true)} label="Ajustes da conversa" />
            </Row>
          ),
        }}
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={insets.top + 44}>
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: space.md, paddingBottom: space.lg, maxWidth: 820, width: '100%', alignSelf: 'center' }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={<Text style={[type.small, { textAlign: 'center', marginTop: space.xxl }]}>Diga olá para começar a história.</Text>}
          ListFooterComponent={
            typingName ? (
              <Row style={{ paddingLeft: 40, marginTop: space.xs }}>
                <ActivityIndicator size="small" color={colors.signal} />
                <Text style={type.small}>{typingName} está digitando…</Text>
              </Row>
            ) : undefined
          }
        />

        {error ? (
          <View style={{ paddingHorizontal: space.md }}>
            <Banner tone="danger" text={error} />
          </View>
        ) : null}

        <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, space.sm) }]}>
          {isGroup && meta.members.length ? (
            <View style={{ marginBottom: space.sm }}>
              <ChipScroller>
                <Chip label="Todos" icon="people" active={!audience} onPress={() => setAudience(null)} />
                {meta.members.map((m) => (
                  <Chip key={m.id} label={`Só ${m.name}`} icon="lock-closed" active={audience === m.id} onPress={() => setAudience(audience === m.id ? null : m.id)} />
                ))}
              </ChipScroller>
            </View>
          ) : null}
          {images.length ? (
            <Row style={{ marginBottom: space.sm }} gap={6}>
              {images.map((img, i) => (
                <View key={img.uri}>
                  <Image source={{ uri: img.uri }} style={{ width: 56, height: 56, borderRadius: radius.sm }} />
                  <Pressable onPress={() => setImages((prev) => prev.filter((_, j) => j !== i))} style={styles.removeImg}>
                    <Ionicons name="close" size={12} color="#fff" />
                  </Pressable>
                </View>
              ))}
            </Row>
          ) : null}
          <Row style={{ alignItems: 'flex-end' }}>
            <IconButton icon="image-outline" onPress={addImage} color={colors.muted} label="Enviar imagem" />
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder={audience ? `Mensagem privada para ${names.get(audience)?.name}` : `Mensagem para ${title}`}
              placeholderTextColor={colors.faint}
              multiline
              maxLength={8000}
              style={styles.input}
              onSubmitEditing={Platform.OS === 'web' ? send : undefined}
              blurOnSubmit={false}
            />
            {busy ? (
              <Pressable onPress={stop} style={[styles.sendBtn, { backgroundColor: colors.overlay }]} accessibilityLabel="Parar">
                <Ionicons name="stop" size={18} color={colors.text} />
              </Pressable>
            ) : (
              <Pressable onPress={send} disabled={!text.trim() && !images.length} style={[styles.sendBtn, !text.trim() && !images.length && { opacity: 0.4 }]} accessibilityLabel="Enviar">
                <Ionicons name="arrow-up" size={20} color={colors.accentInk} />
              </Pressable>
            )}
          </Row>
        </View>
      </KeyboardAvoidingView>

      <ActionSheet visible={Boolean(menuFor)} onClose={() => setMenuFor(null)} actions={menuFor ? menuActions(menuFor) : []} />

      <ActionSheet
        visible={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Apagar mensagem"
        actions={
          deleting
            ? [
                { label: 'Remover do histórico', icon: 'eye-off-outline', onPress: () => remove(deleting, false) },
                { label: 'Apagar definitivamente (e memórias)', icon: 'trash', danger: true, onPress: () => remove(deleting, true) },
              ]
            : []
        }
      />

      <Panel visible={Boolean(editing)} onClose={() => setEditing(null)} title="Editar mensagem">
        <TextInput value={editText} onChangeText={setEditText} multiline style={[styles.input, { minHeight: 120, marginBottom: space.md }]} placeholderTextColor={colors.faint} />
        <Segmented
          value={editMode}
          onChange={setEditMode}
          options={[
            { value: 'branch', label: 'Nova ramificação' },
            { value: 'replace', label: 'Substituir' },
          ]}
        />
        <Text style={[type.small, { marginVertical: space.md }]}>
          {editMode === 'branch'
            ? 'A versão original continua salva em outra ramificação (use ‹ › para alternar).'
            : 'A mensagem e tudo o que veio depois saem do histórico; memórias derivadas são invalidadas.'}
          {editing?.role === 'user' ? ' O personagem responde de novo a partir daqui.' : ''}
        </Text>
        <Button title="Salvar" onPress={submitEdit} disabled={!editText.trim()} style={{ marginBottom: space.lg }} />
      </Panel>

      <Panel visible={settings} onClose={() => setSettings(false)} title="Ajustes da conversa">
        <Text style={[type.tiny, { marginBottom: space.sm }]}>Persona</Text>
        <ChipScroller>
          <Chip label="Nenhuma" active={!meta.conversation.persona_id} onPress={() => updateConversation({ persona_id: null })} />
          {meta.personas.map((p) => (
            <Chip key={p.id} label={p.name} active={meta.conversation.persona_id === p.id} onPress={() => updateConversation({ persona_id: p.id })} />
          ))}
          <Chip label="Gerenciar" icon="add" onPress={() => { setSettings(false); router.push('/personas'); }} />
        </ChipScroller>
        <Text style={[type.tiny, { marginTop: space.lg, marginBottom: space.sm }]}>Criatividade</Text>
        <Segmented
          value={(CREATIVITY.find((c) => Math.abs(Number(c.value) - meta.conversation.creativity) < 0.16)?.value ?? '0.5') as (typeof CREATIVITY)[number]['value']}
          onChange={(v) => updateConversation({ creativity: Number(v) })}
          options={CREATIVITY.map((c) => ({ value: c.value, label: c.label }))}
        />
        <View style={{ marginTop: space.lg, gap: space.sm, marginBottom: space.lg }}>
          <Button title="Memórias do personagem" variant="secondary" icon="bulb-outline" onPress={() => { setSettings(false); router.push(`/memories/${id}`); }} />
          <Button
            title={meta.conversation.is_favorite ? 'Remover dos favoritos' : 'Favoritar conversa'}
            variant="secondary"
            icon={meta.conversation.is_favorite ? 'star' : 'star-outline'}
            onPress={() => updateConversation({ is_favorite: !meta.conversation.is_favorite })}
          />
          <Button
            title={meta.conversation.is_archived ? 'Desarquivar' : 'Arquivar'}
            variant="secondary"
            icon="archive-outline"
            onPress={() => updateConversation({ is_archived: !meta.conversation.is_archived })}
          />
          {messages.some((m) => m.is_pinned) ? (
            <View style={{ marginTop: space.sm }}>
              <Text style={[type.tiny, { marginBottom: space.sm }]}>Fixadas</Text>
              {messages
                .filter((m) => m.is_pinned)
                .map((m) => (
                  <Text key={m.id} style={[type.small, { marginBottom: 6 }]} numberOfLines={2}>
                    📌 {m.content}
                  </Text>
                ))}
            </View>
          ) : null}
        </View>
      </Panel>

      <Panel visible={searchOpen} onClose={() => setSearchOpen(false)} title="Pesquisar no histórico">
        <Row>
          <TextInput value={search} onChangeText={setSearch} onSubmitEditing={runSearch} placeholder="Palavra ou frase" placeholderTextColor={colors.faint} style={[styles.input, { flex: 1 }]} returnKeyType="search" />
          <Button title="Buscar" small onPress={runSearch} />
        </Row>
        <View style={{ marginTop: space.md, marginBottom: space.lg, gap: space.sm }}>
          {results.map((r) => (
            <View key={r.id} style={{ padding: space.sm, backgroundColor: colors.raised, borderRadius: radius.sm }}>
              <Text style={type.tiny}>{r.role === 'user' ? 'Você' : title}</Text>
              <Text style={type.small} numberOfLines={3}>
                {r.content}
              </Text>
            </View>
          ))}
          {search && !results.length ? <Text style={type.small}>Nenhum resultado (inclui todas as ramificações).</Text> : null}
        </View>
      </Panel>
    </View>
  );
}

const styles = StyleSheet.create({
  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, marginBottom: space.md },
  speaker: { color: colors.signal, fontSize: 12, fontWeight: '700', marginBottom: 3, marginLeft: 4 },
  bubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  userBubble: { backgroundColor: colors.userBubble, borderBottomRightRadius: 6 },
  botBubble: { backgroundColor: colors.botBubble, borderBottomLeftRadius: 6, borderWidth: 1, borderColor: colors.borderSoft },
  chatImage: { width: 180, height: 180, borderRadius: 12 },
  composer: { paddingHorizontal: space.sm, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.borderSoft, backgroundColor: colors.bg },
  input: { flex: 1, minHeight: 44, maxHeight: 140, backgroundColor: colors.surface, borderRadius: 22, borderWidth: 1, borderColor: colors.border, color: colors.text, paddingHorizontal: space.lg, paddingTop: 11, paddingBottom: 11, fontSize: 15 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  removeImg: { position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
});
