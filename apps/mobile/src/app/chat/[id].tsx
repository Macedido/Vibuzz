import type { StreamEvent } from '@vibuzz/shared';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EMOTION_LABELS, type ProactiveMode } from '@vibuzz/shared';
import { CoverArt, paletteFor } from '@/components/character-card';
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
import { useAuth } from '@/lib/auth';
import { enablePush, isPushOn, pushSupported } from '@/lib/pwa';
import { chatImageUrl, mediaUrl, supabase } from '@/lib/supabase';
import { askMicrophone, canCall, listenOnce, speak, stopSpeaking, type VoiceStyle } from '@/lib/voice';
import { colors, radius, space, type } from '@/lib/theme';
import type { Persona, PathMessage } from '@/lib/types';
import { pickImage, uploadImage, type PickedImage } from '@/lib/upload';

interface Meta {
  conversation: {
    id: string;
    title: string;
    character_id: string;
    persona_id: string | null;
    creativity: number;
    is_favorite: boolean;
    is_archived: boolean;
    proactive_mode: ProactiveMode;
    language: string | null;
  };
  character: { id: string; name: string; avatar_path: string | null; kind: string; voice?: VoiceStyle | null } | null;
  members: { id: string; name: string; avatar_path: string | null }[];
  personas: Persona[];
}

interface UiMessage extends PathMessage {
  streaming?: boolean;
  failed?: boolean;
  localImages?: string[];
  photo?: 'pending' | 'failed';
  translated?: string;
}

const LANGUAGES = [
  { value: '', label: 'Automático' },
  { value: 'português do Brasil', label: 'Português' },
  { value: 'English', label: 'English' },
  { value: 'español', label: 'Español' },
  { value: 'français', label: 'Français' },
  { value: '日本語', label: '日本語' },
];

/** Hides the "[foto: …]" line (also while it is still being typed). */
function visibleText(t: string): string {
  return t.replace(/\[(?:foto|photo|imagem|image|selfie)\s*:[^\]]*(\]|$)/gi, '').trim();
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
  const { width: screenW } = useWindowDimensions();
  const wide = Platform.OS === 'web' && screenW >= 1100;
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
  const { account, refresh: refreshAccount } = useAuth();
  const [autoVoice, setAutoVoice] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [call, setCall] = useState<'off' | 'listening' | 'thinking' | 'speaking'>('off');
  const [heard, setHeard] = useState('');
  const [pushState, setPushState] = useState<'unknown' | 'on' | 'off'>('unknown');
  const callRef = useRef<{ stop: () => void } | null>(null);
  const callOn = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<FlatList<UiMessage>>(null);
  // Follow new messages only while the reader is at the bottom; otherwise offer a "go down" button.
  const atBottom = useRef(true);
  const [showDown, setShowDown] = useState(false);
  const [unseen, setUnseen] = useState(false);
  const toBottom = useCallback((animated = false) => {
    atBottom.current = true;
    setShowDown(false);
    setUnseen(false);
    listRef.current?.scrollToEnd({ animated });
    // Late layout (images, emotion chips) can add height after the first jump.
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }));
    setTimeout(() => atBottom.current && listRef.current?.scrollToEnd({ animated: false }), 140);
  }, []);
  const onListScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const gap = contentSize.height - layoutMeasurement.height - contentOffset.y;
    const near = gap < 120;
    atBottom.current = near;
    setShowDown((v) => (v === !near ? v : !near));
    if (near) setUnseen(false);
  }, []);
  const onListGrow = useCallback(() => {
    if (atBottom.current) toBottom(false);
    else setUnseen(true);
  }, [toBottom]);

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
        await supabase.from('conversations').select('id, title, character_id, persona_id, creativity, is_favorite, is_archived, proactive_mode, language').eq('id', id).maybeSingle(),
      ) as Meta['conversation'] | null;
      if (!conv) throw new Error('Conversa não encontrada.');
      const [character, members, personas] = await Promise.all([
        supabase.from('characters').select('id, name, avatar_path, kind, voice').eq('id', conv.character_id).maybeSingle(),
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

  const onReplyDone = useRef<((m: UiMessage) => void) | null>(null);
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
          setMessages((prev) =>
            prev.map((m) => (m.id === e.message.id ? { ...m, ...e.message, streaming: false, photo: e.message.image_paths?.length ? undefined : m.photo } : m)),
          );
          if (e.message.role === 'assistant') onReplyDone.current?.(e.message as unknown as UiMessage);
          break;
        case 'image':
          setMessages((prev) => prev.map((m) => (m.id === e.messageId ? { ...m, photo: e.status } : m)));
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
        // Emotions and relationship meters arrive a few seconds later (background job).
        setTimeout(() => void loadPath().catch(() => {}), 8000);
        // Re-sync with the server: ids, siblings and branch state.
        await loadPath().catch(() => {});
      }
    },
    [handleEvent, loadPath],
  );

  const send = async (override?: string) => {
    const content = (override ?? text).trim();
    const picked = override !== undefined ? [] : images;
    if ((!content && !picked.length) || busy) return;
    void Haptics.selectionAsync().catch(() => {});
    if (override === undefined) {
      setText('');
      setImages([]);
    }
    toBottom(true);
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
    // Hide it right away: your message plus the replies under it (until your next message).
    setMessages((prev) => {
      const i = prev.findIndex((x) => x.id === m.id);
      if (i === -1) return prev;
      let j = i + 1;
      if (m.role === 'user') while (j < prev.length && prev[j].role === 'assistant') j++;
      return [...prev.slice(0, i), ...prev.slice(j)];
    });
    try {
      await api(`/v1/messages/${m.id}?purge=${purge ? 1 : 0}`, { method: 'DELETE' });
      await loadPath();
    } catch (e) {
      setError(errorMessage(e));
      await loadPath();
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

  /* -------------------------------- voice -------------------------------- */

  const voiceFor = (m: UiMessage) => {
    const who = m.speaker_character_id ?? meta?.character?.id ?? 'x';
    const style = who === meta?.character?.id ? meta?.character?.voice ?? undefined : undefined;
    return { characterId: who, style: style ?? undefined };
  };

  const ensureVoice = async (): Promise<boolean> => {
    if (account?.voice_enabled) return true;
    const { error: e } = await supabase.from('users').update({ voice_enabled: true }).eq('id', account?.id ?? '');
    if (e) {
      setError('Não foi possível ativar a voz.');
      return false;
    }
    await refreshAccount();
    return true;
  };

  const listen = (m: UiMessage) => {
    if (speakingId === m.id) {
      stopSpeaking();
      setSpeakingId(null);
      return;
    }
    void ensureVoice().then((ok) => {
      if (!ok) return;
      setSpeakingId(m.id);
      void speak(m.content, { ...voiceFor(m), onDone: () => setSpeakingId((cur) => (cur === m.id ? null : cur)) });
    });
  };

  const callListen = () => {
    if (!callOn.current) return;
    setCall('listening');
    setHeard('');
    const lang = meta?.conversation.language && !/portugu/i.test(meta.conversation.language) ? 'en-US' : 'pt-BR';
    const session = listenOnce(lang, setHeard);
    callRef.current = session;
    session.promise
      .then((said) => {
        if (!callOn.current) return;
        if (!said) return callListen();
        setCall('thinking');
        void send(said);
      })
      .catch(() => {
        callOn.current = false;
        setCall('off');
        setError('O microfone não respondeu. Confira a permissão do navegador.');
      });
  };

  const startCall = async () => {
    if (!(await ensureVoice())) return;
    if (!(await askMicrophone())) {
      setError('Permita o microfone para fazer chamadas de voz.');
      return;
    }
    callOn.current = true;
    callListen();
  };

  const endCall = () => {
    callOn.current = false;
    callRef.current?.stop();
    stopSpeaking();
    setCall('off');
  };

  onReplyDone.current = (m) => {
    if (callOn.current) {
      setCall('speaking');
      void speak(m.content, { ...voiceFor(m), onDone: () => callListen() });
    } else if (autoVoice && account?.voice_enabled) {
      setSpeakingId(m.id);
      void speak(m.content, { ...voiceFor(m), onDone: () => setSpeakingId(null) });
    }
  };

  useEffect(
    () => () => {
      callOn.current = false;
      stopSpeaking();
    },
    [],
  );

  useEffect(() => {
    if (!pushSupported()) return;
    void isPushOn().then((on) => setPushState(on ? 'on' : 'off'));
  }, []);

  /* ------------------------------ life ------------------------------- */

  const setProactive = async (mode: ProactiveMode) => {
    if (mode !== 'off' && !account?.spontaneous_messages) {
      await supabase.from('users').update({ spontaneous_messages: true }).eq('id', account?.id ?? '');
      await refreshAccount();
    }
    await updateConversation({ proactive_mode: mode });
  };

  const nudge = async () => {
    try {
      setBusy(true);
      await api(`/v1/conversations/${id}/nudge`, { body: {} });
      await loadPath();
      setSettings(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const turnOnPush = async () => {
    try {
      const r = await enablePush();
      setPushState(r === 'on' ? 'on' : 'off');
      if (r === 'denied') setError('As notificações foram bloqueadas no navegador. Libere nas configurações do site.');
      if (r === 'on') await api('/v1/push/test', { body: {} }).catch(() => {});
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const translate = async (m: UiMessage) => {
    if (m.translated) {
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, translated: undefined } : x)));
      return;
    }
    const lang = meta?.conversation.language || (/[ãõçáéíóú]|\b(você|não|é)\b/i.test(m.content) ? 'English' : 'português do Brasil');
    try {
      const out = await api<{ text: string }>(`/v1/messages/${m.id}/translate`, { body: { lang } });
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, translated: out.text } : x)));
    } catch (e) {
      setError(errorMessage(e));
    }
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
  const backdrop = mediaUrl(meta.character?.avatar_path);
  /** Web: Enter sends, Shift+Enter breaks the line. */
  const onKeyPress = (e: { nativeEvent: unknown; preventDefault: () => void }) => {
    if (Platform.OS !== 'web') return;
    const ev = e.nativeEvent as { key?: string; shiftKey?: boolean; isComposing?: boolean };
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
      e.preventDefault();
      if (!busy && (text.trim() || images.length)) void send();
    }
  };

  const menuActions = (m: UiMessage): SheetAction[] => {
    const acts: SheetAction[] = [{ label: 'Copiar', icon: 'copy-outline', onPress: () => Clipboard.setStringAsync(visibleText(m.content)) }];
    if (!m.id.startsWith('temp-')) {
      if (m.role === 'assistant') acts.push({ label: speakingId === m.id ? 'Parar de ouvir' : 'Ouvir', icon: 'volume-high-outline', onPress: () => listen(m) });
      acts.push({ label: m.translated ? 'Ver original' : 'Traduzir', icon: 'language-outline', onPress: () => translate(m) });
      acts.push({ label: 'Editar', icon: 'create-outline', onPress: () => { setEditing(m); setEditText(m.content); setEditMode('branch'); } });
      if (m.role === 'assistant' && m.parent_id) acts.push({ label: 'Regenerar resposta', icon: 'refresh', onPress: () => regenerate(m) });
      if (m.role === 'assistant' && m.id === last?.id) acts.push({ label: 'Continuar resposta', icon: 'play-forward-outline', onPress: () => run(`/v1/conversations/${id}/continue`, {}) });
      acts.push({ label: m.is_pinned ? 'Desafixar' : 'Fixar mensagem', icon: m.is_pinned ? 'pin' : 'pin-outline', onPress: () => togglePin(m) });
      acts.push({ label: m.role === 'user' ? 'Apagar (com a resposta)' : 'Apagar', icon: 'trash-outline', danger: true, onPress: () => setDeleting(m) });
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
          {!mine ? <Text style={styles.speaker}>{speaker?.name ?? title}</Text> : null}
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
            {visibleText(m.content) ? (
              <RoleplayText text={visibleText(m.content)} style={{ ...type.body, color: mine ? colors.userBubbleText : colors.text }} actionColor={mine ? 'rgba(255,255,255,0.72)' : colors.muted} />
            ) : m.streaming ? (
              <ActivityIndicator size="small" color={colors.muted} />
            ) : null}
            {m.photo === 'pending' ? (
              <View style={styles.photoPending}>
                <ActivityIndicator size="small" color={colors.signal} />
                <Text style={[type.small, { color: colors.signal }]}>{(speaker?.name ?? title).split(' ')[0]} está mandando uma foto…</Text>
              </View>
            ) : m.photo === 'failed' ? (
              <Text style={[type.small, { marginTop: 6, color: colors.faint }]}>A foto não saiu desta vez.</Text>
            ) : null}
            {m.translated ? (
              <View style={styles.translation}>
                <Ionicons name="language-outline" size={12} color={colors.muted} />
                <RoleplayText text={m.translated} style={{ ...type.body, fontSize: 14, color: colors.textSoft, flex: 1 }} actionColor={colors.muted} />
              </View>
            ) : null}
          </Pressable>
          {!mine && (m.emotion || m.is_spontaneous) && !m.streaming ? (
            <Row gap={6} style={{ marginTop: 4 }}>
              {m.emotion && m.emotion !== 'neutro' ? (
                <Text style={styles.emotion}>
                  {EMOTION_LABELS[m.emotion].emoji} {EMOTION_LABELS[m.emotion].label}
                </Text>
              ) : null}
              {m.is_spontaneous ? <Text style={[styles.emotion, { color: colors.signal }]}>mandou sozinho</Text> : null}
            </Row>
          ) : null}
          <Row gap={8} style={{ marginTop: 3, paddingHorizontal: 4 }}>
            {m.is_pinned ? <Ionicons name="pin" size={11} color={colors.accent} /> : null}
            {mine && !m.id.startsWith('temp-') && !busy ? (
              <Pressable onPress={() => setDeleting(m)} hitSlop={8} accessibilityLabel="Apagar mensagem">
                <Ionicons name="trash-outline" size={14} color={colors.muted} />
              </Pressable>
            ) : null}
            {!m.id.startsWith('temp-') && !m.streaming ? (
              <Pressable onPress={() => setMenuFor(m)} hitSlop={8} accessibilityLabel="Mais opções">
                <Ionicons name="ellipsis-horizontal" size={14} color={colors.muted} />
              </Pressable>
            ) : null}
            {!mine && !m.streaming && m.content ? (
              <Pressable onPress={() => listen(m)} hitSlop={8} accessibilityLabel="Ouvir mensagem">
                <Ionicons name={speakingId === m.id ? 'stop-circle-outline' : 'volume-medium-outline'} size={14} color={speakingId === m.id ? colors.signal : colors.muted} />
              </Pressable>
            ) : null}
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
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {backdrop ? (
          <Image source={{ uri: backdrop }} style={[StyleSheet.absoluteFill, { opacity: 0.38 }]} contentFit="cover" blurRadius={14} />
        ) : (
          <LinearGradient colors={paletteFor(title)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { opacity: 0.55 }]} />
        )}
        <LinearGradient colors={['rgba(10,10,15,0.35)', 'rgba(10,10,15,0.78)', 'rgba(10,10,15,0.96)']} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
      </View>
      <Stack.Screen
        options={{
          headerStyle: { backgroundColor: 'rgba(10,10,15,0.72)' },
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
              {canCall() ? <IconButton icon="call-outline" size={20} onPress={startCall} label="Chamada de voz" /> : null}
              <IconButton
                icon={autoVoice ? 'volume-high' : 'volume-mute-outline'}
                size={20}
                onPress={() => void ensureVoice().then((ok) => ok && setAutoVoice((v) => !v))}
                label={autoVoice ? 'Desligar leitura em voz alta' : 'Ler respostas em voz alta'}
              />
              <IconButton icon="search" size={20} onPress={() => setSearchOpen(true)} label="Pesquisar" />
              <IconButton icon="options-outline" size={21} onPress={() => setSettings(true)} label="Ajustes da conversa" />
            </Row>
          ),
        }}
      />
      <View style={{ flex: 1, flexDirection: 'row' }}>
      {wide ? (
        <View style={styles.side}>
          <View style={styles.sideArt}>
            <CoverArt c={{ name: title, avatar_path: meta.character?.avatar_path ?? null }} initialSize={110} />
            <LinearGradient colors={['transparent', 'rgba(10,10,15,0.9)']} locations={[0.55, 1]} style={StyleSheet.absoluteFill} />
            <View style={{ position: 'absolute', left: space.md, right: space.md, bottom: space.md }}>
              <Text style={[type.h1, { color: '#fff' }]} numberOfLines={2}>
                {title}
              </Text>
              {persona ? <Text style={[type.small, { color: colors.textSoft }]}>Você está como {persona.name}</Text> : null}
            </View>
          </View>
          <View style={{ gap: space.sm, marginTop: space.md }}>
            {meta.character ? <Button title="Ver perfil" variant="secondary" small icon="person-outline" onPress={() => router.push(`/character/${meta.character!.id}`)} /> : null}
            <Button title="Memórias" variant="secondary" small icon="bulb-outline" onPress={() => router.push(`/memories/${id}`)} />
            <Button title="Ajustes da conversa" variant="ghost" small icon="options-outline" onPress={() => setSettings(true)} />
          </View>
          <Text style={[type.small, { marginTop: space.md, color: colors.faint }]}>Enter envia · Shift+Enter pula linha</Text>
        </View>
      ) : null}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 44 : insets.top + 56 - insets.bottom}>
        <View style={{ flex: 1 }}>
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: space.md, paddingBottom: space.lg, maxWidth: 820, width: '100%', alignSelf: 'center' }}
          onScroll={onListScroll}
          scrollEventThrottle={64}
          onContentSizeChange={onListGrow}
          onLayout={() => atBottom.current && listRef.current?.scrollToEnd({ animated: false })}
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
        {showDown ? (
          <Pressable onPress={() => toBottom(true)} style={({ pressed }) => [styles.downBtn, pressed && { opacity: 0.85 }]} accessibilityRole="button" accessibilityLabel="Ir para a mensagem mais recente">
            <Ionicons name="arrow-down" size={20} color={colors.text} />
            {unseen ? <View style={styles.downDot} /> : null}
          </Pressable>
        ) : null}
        </View>

        {error ? (
          <View style={{ paddingHorizontal: space.md }}>
            <Banner tone="danger" text={error} />
            {/Premium/.test(error) ? <Button title="Ver o Premium" small variant="secondary" onPress={() => router.push('/premium')} style={{ alignSelf: 'flex-start', marginTop: -space.sm, marginBottom: space.sm }} /> : null}
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
              onKeyPress={onKeyPress}
            />
            {busy ? (
              <Pressable onPress={stop} style={[styles.sendBtn, { backgroundColor: colors.overlay }]} accessibilityLabel="Parar">
                <Ionicons name="stop" size={18} color={colors.text} />
              </Pressable>
            ) : (
              <Pressable onPress={() => void send()} disabled={!text.trim() && !images.length} style={[styles.sendBtn, !text.trim() && !images.length && { opacity: 0.4 }]} accessibilityLabel="Enviar">
                <Ionicons name="arrow-up" size={20} color={colors.accentInk} />
              </Pressable>
            )}
          </Row>
        </View>
      </KeyboardAvoidingView>
      </View>

      <ActionSheet visible={Boolean(menuFor)} onClose={() => setMenuFor(null)} actions={menuFor ? menuActions(menuFor) : []} />

      {call !== 'off' ? (
        <View style={styles.call}>
          <View style={styles.callArt}>
            <CoverArt c={{ name: title, avatar_path: meta.character?.avatar_path ?? null }} initialSize={80} />
          </View>
          <Text style={[type.h1, { marginTop: space.lg }]}>{title}</Text>
          <Text style={[type.body, { color: colors.signal, marginTop: space.xs }]}>
            {call === 'listening' ? 'Ouvindo você…' : call === 'thinking' ? 'Pensando…' : 'Falando…'}
          </Text>
          <Text style={[type.small, { marginTop: space.md, minHeight: 40, textAlign: 'center', maxWidth: 420 }]} numberOfLines={3}>
            {call === 'listening' ? heard || 'Pode falar.' : ''}
          </Text>
          <Pressable onPress={endCall} style={styles.hangup} accessibilityLabel="Encerrar chamada">
            <Ionicons name="call" size={26} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
          </Pressable>
        </View>
      ) : null}

      <ActionSheet
        visible={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title={deleting?.role === 'user' ? 'Apagar sua mensagem? A resposta do personagem também some.' : 'Apagar esta resposta?'}
        actions={
          deleting
            ? [
                {
                  label: deleting.role === 'user' ? 'Apagar mensagem e resposta' : 'Apagar resposta',
                  icon: 'trash',
                  danger: true,
                  onPress: () => remove(deleting, true),
                },
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
        <Text style={[type.tiny, { marginTop: space.lg, marginBottom: space.sm }]}>Vida própria</Text>
        <Segmented
          value={meta.conversation.proactive_mode ?? 'off'}
          onChange={(v) => void setProactive(v)}
          options={[
            { value: 'off', label: 'Desligada' },
            { value: 'sometimes', label: 'Às vezes' },
            { value: 'often', label: 'Sempre que der' },
          ]}
        />
        <Text style={[type.small, { marginTop: space.xs }]}>
          {meta.conversation.proactive_mode === 'off'
            ? `${title.split(' ')[0]} só fala quando você falar.`
            : `${title.split(' ')[0]} pode mandar mensagem ou contar algo que aconteceu quando você sumir (entre 8h e 23h). Nunca duas seguidas sem você responder.`}
        </Text>
        {meta.conversation.proactive_mode !== 'off' ? (
          <Row gap={space.sm} style={{ marginTop: space.sm, flexWrap: 'wrap' }}>
            <Chip label="Testar agora" icon="sparkles" onPress={nudge} />
            {pushSupported() && pushState !== 'on' ? <Chip label="Avisar no navegador" icon="notifications-outline" onPress={turnOnPush} /> : null}
            {pushState === 'on' ? <Chip label="Notificações ligadas" icon="notifications" active onPress={() => {}} /> : null}
          </Row>
        ) : null}
        <Text style={[type.tiny, { marginTop: space.lg, marginBottom: space.sm }]}>Idioma das respostas</Text>
        <ChipScroller>
          {LANGUAGES.map((l) => (
            <Chip key={l.label} label={l.label} active={(meta.conversation.language ?? '') === l.value} onPress={() => updateConversation({ language: l.value || null })} />
          ))}
        </ChipScroller>
        <View style={{ marginTop: space.lg, gap: space.sm, marginBottom: space.lg }}>
          <Button title="Galeria de imagens" variant="secondary" icon="images-outline" onPress={() => { setSettings(false); router.push(`/gallery/${id}`); }} />
          <Button title="Relação" variant="secondary" icon="heart-half-outline" onPress={() => { setSettings(false); router.push(`/relationship/${id}`); }} />
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
  msgRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, marginBottom: space.md },
  speaker: { color: colors.signal, fontSize: 12, fontWeight: '800', marginBottom: 3, marginLeft: 4 },
  bubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  userBubble: { backgroundColor: colors.userBubble, borderTopRightRadius: 6 },
  botBubble: { backgroundColor: 'rgba(22,22,32,0.86)', borderTopLeftRadius: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  chatImage: { width: 180, height: 180, borderRadius: 12 },
  downBtn: {
    position: 'absolute',
    right: space.lg,
    bottom: space.md,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.border,
    ...Platform.select({ web: { boxShadow: '0 6px 18px rgba(0,0,0,0.45)' } as object, default: { elevation: 4 } }),
  },
  downDot: { position: 'absolute', top: 8, right: 9, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  composer: { paddingHorizontal: space.sm, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)', backgroundColor: 'rgba(10,10,15,0.9)', width: '100%', maxWidth: 860, alignSelf: 'center' },
  input: { flex: 1, minHeight: 44, maxHeight: 140, backgroundColor: 'rgba(26,26,37,0.95)', borderRadius: 22, borderWidth: 1, borderColor: colors.border, color: colors.text, paddingHorizontal: space.lg, paddingTop: 11, paddingBottom: 11, fontSize: 15 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  photoPending: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  translation: { flexDirection: 'row', gap: 6, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)' },
  emotion: { color: colors.muted, fontSize: 11, backgroundColor: 'rgba(18,23,56,0.85)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, overflow: 'hidden' },
  call: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(3,4,26,0.96)', alignItems: 'center', justifyContent: 'center', padding: space.xl },
  callArt: { width: 160, height: 160, borderRadius: 80, overflow: 'hidden', borderWidth: 3, borderColor: colors.accent },
  hangup: { marginTop: space.xxl, width: 68, height: 68, borderRadius: 34, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  side: { width: 300, padding: space.lg, borderRightWidth: 1, borderRightColor: 'rgba(255,255,255,0.05)', backgroundColor: 'rgba(10,10,15,0.55)' },
  sideArt: { width: '100%', aspectRatio: 0.75, borderRadius: radius.xl, overflow: 'hidden' },
  removeImg: { position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
});
