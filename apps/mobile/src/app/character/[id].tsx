import { CATEGORIES } from '@vibuzz/shared';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as Linking from 'expo-linking';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, Share, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { RoleplayText } from '@/components/rich-text';
import {
  ActionSheet,
  Avatar,
  Banner,
  Button,
  Card,
  Chip,
  ErrorState,
  IconButton,
  Ionicons,
  Loading,
  Panel,
  Row,
  Screen,
  Section,
} from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { unwrap, useQuery } from '@/lib/hooks';
import { mediaUrl, supabase } from '@/lib/supabase';
import { colors, radius, space, type } from '@/lib/theme';
import { compact, timeAgo, type CharacterCard, type Persona } from '@/lib/types';

interface Comment {
  id: string;
  body: string;
  created_at: string;
  user_id: string;
  author: { username: string; display_name: string; avatar_path: string | null } | null;
}

export default function CharacterPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { userId } = useAuth();
  const { width } = useWindowDimensions();
  const [menu, setMenu] = useState(false);
  const [pickPersona, setPickPersona] = useState(false);
  const [starting, setStarting] = useState(false);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const q = useQuery(async () => {
    const card = unwrap(await supabase.from('character_cards').select('*').eq('id', id).maybeSingle()) as CharacterCard | null;
    if (!card) throw new Error('Personagem não encontrado ou indisponível.');
    const [images, members, liked, faved, rating, comments, personas, convs] = await Promise.all([
      supabase.from('character_images').select('path, kind').eq('character_id', id).order('position'),
      card.kind === 'group'
        ? supabase.from('group_members').select('position, member:characters!group_members_member_id_fkey(id, name, tagline, avatar_path)').eq('group_id', id).order('position')
        : Promise.resolve({ data: [], error: null }),
      supabase.from('likes').select('character_id').eq('character_id', id).eq('user_id', userId!).maybeSingle(),
      supabase.from('favorites').select('character_id').eq('character_id', id).eq('user_id', userId!).maybeSingle(),
      supabase.from('ratings').select('score').eq('character_id', id).eq('user_id', userId!).maybeSingle(),
      supabase
        .from('comments')
        .select('id, body, created_at, user_id, author:user_profiles!comments_author_fkey(username, display_name, avatar_path)')
        .eq('character_id', id)
        .is('parent_id', null)
        .order('created_at', { ascending: false })
        .limit(30),
      supabase.from('personas').select('*').order('created_at'),
      supabase.from('conversations').select('id, last_message_at').eq('character_id', id).order('last_message_at', { ascending: false }).limit(1),
    ]);
    return {
      card,
      gallery: ((images.data as { path: string; kind: string }[]) ?? []).filter((i) => i.kind === 'gallery'),
      members: ((members.data as unknown as { member: { id: string; name: string; tagline: string; avatar_path: string | null } }[]) ?? []).map((m) => m.member).filter(Boolean),
      liked: Boolean(liked.data),
      faved: Boolean(faved.data),
      myRating: (rating.data as { score: number } | null)?.score ?? 0,
      comments: (comments.data as unknown as Comment[]) ?? [],
      personas: (personas.data as Persona[]) ?? [],
      existing: ((convs.data as { id: string }[]) ?? [])[0]?.id ?? null,
    };
  }, [id, userId]);

  if (q.loading) return <Loading />;
  if (q.error || !q.data) return <ErrorState message={q.error ?? 'Erro'} onRetry={q.refresh} />;
  const { card, gallery, members, liked, faved, myRating, comments, personas, existing } = q.data;
  const isMine = card.creator_id === userId;
  const cover = mediaUrl(card.avatar_path);
  const heroH = Math.min(width, 720) * 0.9;
  const category = CATEGORIES.find((c) => c.slug === card.category_slug);

  const toggle = async (table: 'likes' | 'favorites', on: boolean) => {
    const key = table === 'likes' ? 'liked' : 'faved';
    const countKey = table === 'likes' ? 'like_count' : 'favorite_count';
    q.setData((d) => d && { ...d, [key]: !on, card: { ...d.card, [countKey]: d.card[countKey] + (on ? -1 : 1) } });
    const res = on
      ? await supabase.from(table).delete().eq('character_id', id).eq('user_id', userId!)
      : await supabase.from(table).insert({ character_id: id, user_id: userId });
    if (res.error) void q.reload();
  };

  const rate = async (score: number) => {
    q.setData((d) => d && { ...d, myRating: score });
    await supabase.from('ratings').upsert({ user_id: userId, character_id: id, score }, { onConflict: 'user_id,character_id' });
  };

  const start = async (personaId: string | null) => {
    setPickPersona(false);
    setStarting(true);
    setErr(null);
    try {
      const res = await api<{ id: string }>('/v1/conversations', { body: { characterId: id, personaId } });
      router.push(`/chat/${res.id}`);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setStarting(false);
    }
  };

  const onChat = () => {
    if (personas.length) setPickPersona(true);
    else void start(null);
  };

  const sendComment = async () => {
    if (!comment.trim()) return;
    setSending(true);
    try {
      await api('/v1/comments', { body: { characterId: id, body: comment.trim() } });
      setComment('');
      void q.reload();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  const shareUrl = Linking.createURL(`/character/${id}`);
  const share = async () => {
    try {
      await Share.share({ message: `Converse com ${card.name} no Vibuzz: ${shareUrl}` });
    } catch {
      await Clipboard.setStringAsync(shareUrl);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: '', headerTransparent: true, headerRight: () => <IconButton icon="ellipsis-horizontal" onPress={() => setMenu(true)} label="Mais" /> }} />
      <Screen padded={false}>
        <View style={{ height: heroH, maxWidth: 720, width: '100%', alignSelf: 'center' }}>
          {cover ? <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <LinearGradient colors={['#2B2350', colors.bg]} style={StyleSheet.absoluteFill} />}
          <LinearGradient colors={['rgba(10,10,15,0.4)', 'transparent', colors.bg]} locations={[0, 0.35, 1]} style={StyleSheet.absoluteFill} />
          <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: space.lg }}>
            <Row gap={6}>
              {card.kind === 'group' ? <Chip label={`Grupo · ${card.member_count}`} icon="people" active /> : null}
              {category ? <Chip label={category.name} /> : null}
              {card.maturity === 'mature' ? <Chip label="18+" /> : null}
            </Row>
            <Text style={[type.hero, { marginTop: space.sm }]}>{card.name}</Text>
            {card.tagline ? <Text style={[type.body, { color: colors.text }]}>{card.tagline}</Text> : null}
          </View>
        </View>

        <View style={{ paddingHorizontal: space.lg, maxWidth: 720, width: '100%', alignSelf: 'center' }}>
          <Pressable onPress={() => router.push(`/user/${card.creator_id}`)}>
            <Row style={{ marginTop: space.sm }}>
              <Avatar path={card.creator_avatar_path} name={card.creator_display_name} size={26} />
              <Text style={type.small}>
                por <Text style={{ color: colors.text, fontWeight: '600' }}>@{card.creator_username}</Text>
              </Text>
            </Row>
          </Pressable>

          <Row style={{ marginTop: space.lg, gap: space.lg }}>
            <Row gap={4}>
              <Ionicons name="chatbubble" size={14} color={colors.muted} />
              <Text style={type.small}>{compact(card.conversation_count)} conversas</Text>
            </Row>
            <Row gap={4}>
              <Ionicons name="heart" size={14} color={colors.muted} />
              <Text style={type.small}>{compact(card.like_count)}</Text>
            </Row>
            {card.rating ? (
              <Row gap={4}>
                <Ionicons name="star" size={14} color={colors.warning} />
                <Text style={type.small}>
                  {Number(card.rating).toFixed(1)} ({card.rating_count})
                </Text>
              </Row>
            ) : null}
          </Row>

          {err ? <View style={{ marginTop: space.md }}><Banner tone="danger" text={err} /></View> : null}

          <Row style={{ marginTop: space.lg }}>
            <Button title={existing ? 'Nova conversa' : 'Conversar'} icon="chatbubble-ellipses" onPress={onChat} loading={starting} style={{ flex: 1 }} />
            {existing ? <Button title="Continuar" variant="secondary" onPress={() => router.push(`/chat/${existing}`)} style={{ flex: 1 }} /> : null}
          </Row>
          <Row style={{ marginTop: space.sm }}>
            <Button title={liked ? 'Curtido' : 'Curtir'} small variant="secondary" icon={liked ? 'heart' : 'heart-outline'} onPress={() => toggle('likes', liked)} style={{ flex: 1 }} />
            <Button title={faved ? 'Favorito' : 'Favoritar'} small variant="secondary" icon={faved ? 'bookmark' : 'bookmark-outline'} onPress={() => toggle('favorites', faved)} style={{ flex: 1 }} />
            <Button title="Compartilhar" small variant="secondary" icon="share-outline" onPress={share} style={{ flex: 1 }} />
          </Row>
          {isMine ? <Button title="Editar personagem" variant="ghost" icon="create-outline" small onPress={() => router.push({ pathname: '/create/editor', params: { id } })} style={{ marginTop: space.sm }} /> : null}

          {card.description ? (
            <Section title="Sobre">
              <Text style={type.body}>{card.description}</Text>
            </Section>
          ) : null}

          {members.length ? (
            <Section title="Integrantes">
              <View style={{ gap: space.sm }}>
                {members.map((m) => (
                  <Row key={m.id} gap={space.md}>
                    <Avatar path={m.avatar_path} name={m.name} size={44} />
                    <View style={{ flex: 1 }}>
                      <Text style={type.h3}>{m.name}</Text>
                      {m.tagline ? <Text style={type.small}>{m.tagline}</Text> : null}
                    </View>
                  </Row>
                ))}
              </View>
            </Section>
          ) : null}

          {card.greeting_preview ? (
            <Section title="Primeira mensagem">
              <Card>
                <RoleplayText text={card.greeting_preview} style={type.body} />
              </Card>
            </Section>
          ) : null}

          {gallery.length ? (
            <Section title="Galeria">
              <Row style={{ flexWrap: 'wrap' }}>
                {gallery.map((g) => (
                  <Image key={g.path} source={{ uri: mediaUrl(g.path)! }} style={{ width: 104, height: 104, borderRadius: radius.md }} contentFit="cover" />
                ))}
              </Row>
            </Section>
          ) : null}

          {card.tags.length ? (
            <Section title="Tags">
              <Row style={{ flexWrap: 'wrap' }}>
                {card.tags.map((t) => (
                  <Chip key={t} label={`#${t}`} onPress={() => router.push({ pathname: '/discover', params: { q: `#${t}` } })} />
                ))}
              </Row>
            </Section>
          ) : null}

          {!isMine ? (
            <Section title="Sua avaliação">
              <Row gap={space.sm}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Pressable key={n} onPress={() => rate(n)} hitSlop={6}>
                    <Ionicons name={n <= myRating ? 'star' : 'star-outline'} size={28} color={n <= myRating ? colors.warning : colors.faint} />
                  </Pressable>
                ))}
              </Row>
            </Section>
          ) : null}

          <Section title={`Comentários${card.comment_count ? ` · ${card.comment_count}` : ''}`}>
            <Row style={{ alignItems: 'flex-end' }}>
              <TextInput
                value={comment}
                onChangeText={setComment}
                placeholder="Escreva um comentário"
                placeholderTextColor={colors.faint}
                multiline
                maxLength={1000}
                style={styles.commentInput}
              />
              <Button title="Enviar" small onPress={sendComment} loading={sending} disabled={!comment.trim()} />
            </Row>
            <View style={{ marginTop: space.md, gap: space.md }}>
              {comments.map((c) => (
                <Row key={c.id} style={{ alignItems: 'flex-start' }} gap={space.sm}>
                  <Avatar path={c.author?.avatar_path} name={c.author?.display_name} size={30} />
                  <View style={{ flex: 1 }}>
                    <Text style={type.small}>
                      <Text style={{ color: colors.text, fontWeight: '600' }}>@{c.author?.username ?? 'usuário'}</Text> · {timeAgo(c.created_at)}
                    </Text>
                    <Text style={type.body}>{c.body}</Text>
                  </View>
                  {c.user_id === userId ? (
                    <IconButton
                      icon="trash-outline"
                      size={16}
                      color={colors.faint}
                      onPress={async () => {
                        await supabase.from('comments').delete().eq('id', c.id);
                        void q.reload();
                      }}
                      label="Apagar comentário"
                    />
                  ) : (
                    <IconButton icon="flag-outline" size={16} color={colors.faint} onPress={() => router.push({ pathname: '/report', params: { type: 'comment', id: c.id } })} label="Denunciar" />
                  )}
                </Row>
              ))}
            </View>
          </Section>
        </View>
      </Screen>

      <ActionSheet
        visible={menu}
        onClose={() => setMenu(false)}
        actions={[
          { label: 'Copiar link', icon: 'link-outline', onPress: () => Clipboard.setStringAsync(shareUrl) },
          ...(isMine
            ? [{ label: 'Editar', icon: 'create-outline' as const, onPress: () => router.push({ pathname: '/create/editor', params: { id } }) }]
            : [{ label: 'Denunciar personagem', icon: 'flag-outline' as const, danger: true, onPress: () => router.push({ pathname: '/report', params: { type: 'character', id } }) }]),
        ]}
      />

      <Panel visible={pickPersona} onClose={() => setPickPersona(false)} title="Conversar como…">
        <Pressable onPress={() => start(null)} style={styles.personaRow}>
          <Avatar name="?" size={40} />
          <View style={{ flex: 1 }}>
            <Text style={type.h3}>Sem persona</Text>
            <Text style={type.small}>O personagem não presume nada sobre você.</Text>
          </View>
        </Pressable>
        {personas.map((p) => (
          <Pressable key={p.id} onPress={() => start(p.id)} style={styles.personaRow}>
            <Avatar path={p.avatar_path} name={p.name} size={40} />
            <View style={{ flex: 1 }}>
              <Text style={type.h3}>
                {p.name} {p.is_default ? <Text style={type.small}>· padrão</Text> : null}
              </Text>
              {p.biography ? (
                <Text style={type.small} numberOfLines={1}>
                  {p.biography}
                </Text>
              ) : null}
            </View>
          </Pressable>
        ))}
        <Button title="Gerenciar personas" variant="ghost" small onPress={() => { setPickPersona(false); router.push('/personas'); }} style={{ marginVertical: space.md }} />
      </Panel>
    </View>
  );
}

const styles = StyleSheet.create({
  commentInput: { flex: 1, minHeight: 42, maxHeight: 120, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, color: colors.text, paddingHorizontal: space.md, paddingVertical: 10 },
  personaRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
});
