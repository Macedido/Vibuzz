import { CATEGORIES } from '@vibuzz/shared';
import { useRouter } from 'expo-router';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { HeroCard, Rail } from '@/components/character-card';
import { Avatar, Chip, ChipScroller, EmptyState, ErrorState, IconButton, Loading, Row, Screen, Section, TopBar } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { unwrap, useQuery } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';
import { colors, radius, space, type } from '@/lib/theme';
import { timeAgo, type CharacterCard, type ConversationItem } from '@/lib/types';

async function loadHome() {
  const discover = (args: Record<string, unknown>) => supabase.rpc('discover_characters', { p_limit: 12, ...args });
  const [rec, trending, popular, recent, following, groups, convs, unread] = await Promise.all([
    supabase.rpc('recommend_characters', { p_limit: 12 }),
    discover({ p_sort: 'trending' }),
    discover({ p_sort: 'popular' }),
    discover({ p_sort: 'recent' }),
    discover({ p_sort: 'recent', p_following_only: true }),
    discover({ p_sort: 'popular', p_kind: 'group' }),
    supabase
      .from('conversations')
      .select('id, title, character_id, last_message_at, last_message_preview, character:characters(id, name, avatar_path, kind)')
      .eq('is_archived', false)
      .order('last_message_at', { ascending: false })
      .limit(8),
    supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null),
  ]);
  return {
    recommended: unwrap(rec) as CharacterCard[],
    trending: unwrap(trending) as CharacterCard[],
    popular: unwrap(popular) as CharacterCard[],
    recent: unwrap(recent) as CharacterCard[],
    following: unwrap(following) as CharacterCard[],
    groups: unwrap(groups) as CharacterCard[],
    conversations: (unwrap(convs) as unknown as ConversationItem[]) ?? [],
    unread: unread.count ?? 0,
  };
}

export default function Home() {
  const router = useRouter();
  const { profile } = useAuth();
  const q = useQuery(loadHome, [], { refetchOnFocus: true });

  const header = (
    <TopBar
      title="Vibuzz"
      subtitle={profile ? `Oi, ${profile.display_name.split(' ')[0]}` : undefined}
      right={<IconButton icon="notifications-outline" badge={(q.data?.unread ?? 0) > 0} onPress={() => router.push('/notifications')} label="Notificações" />}
    />
  );

  if (q.loading)
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        {header}
        <Loading />
      </View>
    );
  if (q.error || !q.data)
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        {header}
        <ErrorState message={q.error ?? 'Erro'} onRetry={q.refresh} />
      </View>
    );

  const d = q.data;
  const hero = d.recommended[0] ?? d.trending[0] ?? d.popular[0];
  const nothing = !hero && !d.conversations.length;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {header}
      <Screen padded={false} style={{ paddingHorizontal: space.lg }} refreshControl={<RefreshControl refreshing={q.refreshing} onRefresh={q.refresh} tintColor={colors.accent} />}>
        {nothing ? (
          <EmptyState
            icon="planet-outline"
            title="O universo está começando"
            message="Ainda não há personagens públicos. Que tal criar o primeiro?"
            action="Criar personagem"
            onAction={() => router.push('/create')}
          />
        ) : null}

        {hero ? <View style={{ marginTop: space.md }}><HeroCard c={hero} /></View> : null}

        {d.conversations.length ? (
          <Section title="Continue suas conversas" action="Ver todas" onAction={() => router.push('/chats')}>
            <View style={{ gap: space.sm }}>
              {d.conversations.slice(0, 4).map((c) => (
                <Pressable key={c.id} onPress={() => router.push(`/chat/${c.id}`)} style={({ pressed }) => [styles.convRow, pressed && { backgroundColor: colors.raised }]}>
                  <Avatar path={c.character?.avatar_path} name={c.character?.name ?? c.title} size={42} />
                  <View style={{ flex: 1 }}>
                    <Row style={{ justifyContent: 'space-between' }}>
                      <Text style={type.h3} numberOfLines={1}>
                        {c.character?.name ?? c.title}
                      </Text>
                      <Text style={type.small}>{timeAgo(c.last_message_at)}</Text>
                    </Row>
                    <Text style={type.small} numberOfLines={1}>
                      {c.last_message_preview}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </Section>
        ) : null}

        {d.recommended.length > 1 ? (
          <Section title="Recomendados para você">
            <Rail items={d.recommended.slice(1)} />
          </Section>
        ) : null}
        {d.trending.length ? (
          <Section title="Em alta" action="Mais" onAction={() => router.push({ pathname: '/discover', params: { sort: 'trending' } })}>
            <Rail items={d.trending} />
          </Section>
        ) : null}
        {d.following.length ? (
          <Section title="De criadores que você segue">
            <Rail items={d.following} />
          </Section>
        ) : null}

        <Section title="Categorias">
          <ChipScroller>
            {CATEGORIES.map((c) => (
              <Chip key={c.slug} label={c.name} onPress={() => router.push({ pathname: '/discover', params: { category: c.slug } })} />
            ))}
          </ChipScroller>
        </Section>

        {d.popular.length ? (
          <Section title="Populares" action="Mais" onAction={() => router.push({ pathname: '/discover', params: { sort: 'popular' } })}>
            <Rail items={d.popular} />
          </Section>
        ) : null}
        {d.groups.length ? (
          <Section title="Universos em grupo" action="Mais" onAction={() => router.push({ pathname: '/discover', params: { kind: 'group' } })}>
            <Rail items={d.groups} />
          </Section>
        ) : null}
        {d.recent.length ? (
          <Section title="Novos" action="Mais" onAction={() => router.push({ pathname: '/discover', params: { sort: 'recent' } })}>
            <Rail items={d.recent} />
          </Section>
        ) : null}
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  convRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.sm, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSoft },
});
