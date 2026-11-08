import { CATEGORIES } from '@vibuzz/shared';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CharacterGrid, CharacterRow, CoverArt } from '@/components/character-card';
import { EmptyState, ErrorState, IconButton, Ionicons, Row } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { unwrap, useQuery } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';
import { colors, fonts, radius, space, type } from '@/lib/theme';
import { compact, timeAgo, type CharacterCard, type ConversationItem } from '@/lib/types';

const LOGO = require('@/assets/images/logo-mark.png');

const PAGE = 30;

type Feed = 'foryou' | 'ranking' | 'trending' | 'recent' | 'popular' | 'groups' | 'following';
const FEEDS: { id: Feed; label: string }[] = [
  { id: 'foryou', label: 'Para você' },
  { id: 'ranking', label: 'Top da semana' },
  { id: 'trending', label: 'Em alta' },
  { id: 'recent', label: 'Novos' },
  { id: 'popular', label: 'Populares' },
  { id: 'groups', label: 'Grupos' },
  { id: 'following', label: 'Seguindo' },
];

function dedupe(rows: CharacterCard[]): CharacterCard[] {
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}

type Ranked = CharacterCard & { rank?: number; score?: number };

async function loadFeed(feed: Feed, category: string | null, offset: number): Promise<{ rows: Ranked[]; more: boolean }> {
  if (feed === 'ranking') {
    const data = (unwrap(await supabase.rpc('weekly_ranking', { p_limit: 50 })) as { rank: number; score: number; card: CharacterCard }[]) ?? [];
    const rows = data.map((r) => ({ ...r.card, rank: r.rank, score: r.score })).filter((r) => !category || r.category_slug === category);
    return { rows, more: false };
  }
  const discover = async (args: Record<string, unknown>) =>
    (unwrap(await supabase.rpc('discover_characters', { p_limit: PAGE, p_offset: offset, p_category: category, ...args })) as CharacterCard[]) ?? [];
  if (feed === 'foryou') {
    if (offset > 0) {
      const rows = await discover({ p_sort: 'popular' });
      return { rows, more: rows.length === PAGE };
    }
    // Personal picks first, then what is hot and what just arrived, so new characters always show up.
    const [rec, trending, recent] = await Promise.all([
      category ? Promise.resolve([] as CharacterCard[]) : supabase.rpc('recommend_characters', { p_limit: 12 }).then((r) => (r.data as CharacterCard[]) ?? []),
      discover({ p_sort: 'trending' }),
      discover({ p_sort: 'recent' }),
    ]);
    const rows = dedupe([...rec, ...trending, ...recent]);
    return { rows, more: rows.length >= PAGE };
  }
  const args: Record<Feed, Record<string, unknown>> = {
    foryou: {},
    ranking: {},
    trending: { p_sort: 'trending' },
    recent: { p_sort: 'recent' },
    popular: { p_sort: 'popular' },
    groups: { p_sort: 'popular', p_kind: 'group' },
    following: { p_sort: 'recent', p_following_only: true },
  };
  const rows = await discover(args[feed]);
  return { rows, more: rows.length === PAGE };
}

async function loadTop() {
  const [convs, unread] = await Promise.all([
    supabase
      .from('conversations')
      .select('id, title, character_id, last_message_at, last_message_preview, character:characters!conversations_character_id_fkey(id, name, avatar_path, kind)')
      .eq('is_archived', false)
      .order('last_message_at', { ascending: false })
      .limit(12),
    supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null),
  ]);
  return { conversations: (unwrap(convs) as unknown as ConversationItem[]) ?? [], unread: unread.count ?? 0 };
}

function ContinueCard({ c }: { c: ConversationItem }) {
  const router = useRouter();
  const name = c.character?.name ?? c.title;
  return (
    <Pressable onPress={() => router.push(`/chat/${c.id}`)} style={({ pressed }) => [styles.cont, pressed && { opacity: 0.85 }]}>
      <View style={styles.contThumb}>
        <CoverArt c={{ name, avatar_path: c.character?.avatar_path ?? null }} initialSize={20} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={type.h3} numberOfLines={1}>
          {name}
        </Text>
        <Text style={[type.small, { fontSize: 12 }]} numberOfLines={1}>
          {c.last_message_preview || 'Continuar história'}
        </Text>
        <Text style={[type.small, { fontSize: 11, color: colors.faint }]}>{timeAgo(c.last_message_at)}</Text>
      </View>
    </Pressable>
  );
}

function RankRow({ c }: { c: Ranked }) {
  const top = (c.rank ?? 99) <= 3;
  return (
    <Row gap={space.sm} style={{ marginBottom: 2 }}>
      {top ? (
        <View style={[styles.rank, { backgroundColor: colors.accent }]}>
          <Text style={[styles.rankText, { color: '#fff' }]}>{c.rank}</Text>
        </View>
      ) : (
        <View style={[styles.rank, { backgroundColor: colors.surface }]}>
          <Text style={styles.rankText}>{c.rank}</Text>
        </View>
      )}
      <View style={{ flex: 1 }}>
        <CharacterRow
          c={c}
          right={
            <Row gap={4}>
              <Ionicons name="flame" size={13} color={top ? colors.signal : colors.faint} />
              <Text style={[type.small, { fontSize: 12 }]}>{compact(c.score ?? 0)}</Text>
            </Row>
          }
        />
      </View>
    </Row>
  );
}

export default function Home() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const top = useQuery(loadTop, [], { refetchOnFocus: true });
  const [feed, setFeed] = useState<Feed>('foryou');
  const [category, setCategory] = useState<string | null>(null);
  const [items, setItems] = useState<Ranked[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (offset: number) => {
      setError(null);
      if (offset === 0) setLoading(true);
      try {
        const res = await loadFeed(feed, category, offset);
        setItems((prev) => (offset ? dedupe([...prev, ...res.rows]) : res.rows));
        setMore(res.more);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [feed, category],
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  const refresh = () => {
    setRefreshing(true);
    top.refresh();
    void load(0);
  };

  const convs = top.data?.conversations ?? [];
  const firstName = profile?.display_name?.split(' ')[0];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={[styles.header, { paddingTop: insets.top + space.sm }]}>
        <Row gap={space.sm} style={{ flexShrink: 0 }}>
          <Image source={LOGO} style={styles.logo} contentFit="contain" accessibilityLabel="Vibuzz" />
          <Text style={styles.brand}>Vibuzz</Text>
        </Row>
        <Pressable onPress={() => router.push('/discover')} style={styles.search} accessibilityRole="search">
          <Ionicons name="search" size={17} color={colors.muted} />
          <Text style={[type.small, { color: colors.faint }]} numberOfLines={1}>
            Buscar personagens, #tags, @criadores
          </Text>
        </Pressable>
        <IconButton icon="notifications-outline" badge={(top.data?.unread ?? 0) > 0} onPress={() => router.push('/notifications')} label="Notificações" />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: insets.bottom + 96 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />}
        stickyHeaderIndices={convs.length ? [2] : [1]}
      >
        <Text style={[type.small, { marginTop: space.xs }]}>{firstName ? `Oi, ${firstName}! Com quem vai ser hoje?` : 'Com quem vai ser hoje?'}</Text>

        {convs.length ? (
          <View style={{ marginTop: space.lg }}>
            <Row style={{ justifyContent: 'space-between', marginBottom: space.sm }}>
              <Text style={type.h2}>Continue de onde parou</Text>
              <Pressable onPress={() => router.push('/chats')} hitSlop={10}>
                <Text style={{ color: colors.accent, fontWeight: '600' }}>Ver todas</Text>
              </Pressable>
            </Row>
            <FlatList
              horizontal
              data={convs}
              keyExtractor={(c) => c.id}
              renderItem={({ item }) => <ContinueCard c={item} />}
              ItemSeparatorComponent={() => <View style={{ width: space.sm }} />}
              showsHorizontalScrollIndicator={false}
            />
          </View>
        ) : null}

        <View style={styles.tabsWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.xs, paddingRight: space.lg }}>
            {FEEDS.map((f) => (
              <Pressable key={f.id} onPress={() => setFeed(f.id)} style={[styles.tab, feed === f.id && styles.tabActive]}>
                <Text style={[styles.tabText, feed === f.id && styles.tabTextActive]}>{f.label}</Text>
              </Pressable>
            ))}
            <View style={styles.divider} />
            {CATEGORIES.map((c) => (
              <Pressable key={c.slug} onPress={() => setCategory(category === c.slug ? null : c.slug)} style={[styles.cat, category === c.slug && styles.catActive]}>
                <Text style={[styles.catText, category === c.slug && { color: colors.accentInk }]}>{c.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        {error ? (
          <ErrorState message={error} onRetry={() => load(0)} />
        ) : loading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: space.xxl }} />
        ) : !items.length ? (
          feed === 'following' ? (
            <EmptyState icon="people-outline" title="Ninguém por aqui" message="Siga criadores para ver os personagens novos deles aqui." />
          ) : feed === 'ranking' ? (
            <EmptyState icon="trophy-outline" title="O ranking da semana está vazio" message="Ele conta conversas e curtidas dos últimos 7 dias. Converse com seus favoritos para colocá-los no topo." />
          ) : (
            <EmptyState
              icon="planet-outline"
              title={category ? 'Nada nessa categoria ainda' : 'O universo está começando'}
              message="Crie um personagem público e ele aparece aqui para todo mundo."
              action="Criar personagem"
              onAction={() => router.push('/create')}
            />
          )
        ) : feed === 'ranking' ? (
          <View style={{ maxWidth: 760 }}>
            <Text style={[type.small, { marginBottom: space.md }]}>Conversas e curtidas dos últimos 7 dias. Atualiza o tempo todo.</Text>
            {items.map((c) => (
              <RankRow key={c.id} c={c} />
            ))}
          </View>
        ) : (
          <CharacterGrid
            items={items}
            footer={
              more ? (
                <Pressable onPress={() => load(items.length)} style={styles.more}>
                  <Text style={{ color: colors.text, fontWeight: '700' }}>Carregar mais</Text>
                </Pressable>
              ) : null
            }
          />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingBottom: space.sm, backgroundColor: colors.bg },
  logo: { width: 32, height: 32 },
  rank: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  rankText: { color: colors.textSoft, fontFamily: fonts.display, fontSize: 14 },
  brand: { color: colors.text, fontFamily: fonts.display, fontSize: 18, letterSpacing: -0.4 },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, height: 40, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSoft, paddingHorizontal: space.md, maxWidth: 520 },
  tabsWrap: { backgroundColor: colors.bg, paddingTop: space.lg, paddingBottom: space.md },
  tab: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill },
  tabActive: { backgroundColor: colors.raised },
  tabText: { color: colors.muted, fontWeight: '700', fontSize: 14 },
  tabTextActive: { color: colors.text },
  divider: { width: 1, height: 22, backgroundColor: colors.border, alignSelf: 'center', marginHorizontal: space.xs },
  cat: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  catActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  catText: { color: colors.textSoft, fontWeight: '600', fontSize: 13 },
  cont: { width: 240, flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.sm, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSoft },
  contThumb: { width: 52, height: 64, borderRadius: radius.md, overflow: 'hidden' },
  more: { marginTop: space.lg, alignSelf: 'center', paddingHorizontal: space.xl, paddingVertical: space.md, borderRadius: radius.pill, backgroundColor: colors.raised },
});
