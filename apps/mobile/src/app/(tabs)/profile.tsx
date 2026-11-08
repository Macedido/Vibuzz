import { isPremiumActive } from '@vibuzz/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { CharacterRow } from '@/components/character-card';
import { PremiumBadge } from '@/components/premium-badge';
import { Avatar, Button, Card, EmptyState, IconButton, Ionicons, ListItem, Loading, Row, Screen, Segmented, TopBar } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { unwrap, useQuery } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';
import { colors, radius, space, type } from '@/lib/theme';
import { compact, type CharacterCard } from '@/lib/types';

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Text style={type.h2}>{compact(value)}</Text>
      <Text style={type.small}>{label}</Text>
    </View>
  );
}

export default function Profile() {
  const router = useRouter();
  const { profile, userId, account, refresh: refreshAuth } = useAuth();
  const [tab, setTab] = useState<'created' | 'favorites' | 'collections'>('created');
  const q = useQuery(
    async () => {
      if (!userId) return null;
      const [mine, favs, stats, cols, badges, allBadges] = await Promise.all([
        supabase.from('character_cards').select('*').eq('creator_id', userId).neq('status', 'removed').order('created_at', { ascending: false }),
        supabase.from('favorites').select('character_id, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(100),
        supabase.rpc('creator_stats', { p_user: userId }),
        supabase.from('collections').select('id, name, item_count, is_public').eq('owner_id', userId).order('updated_at', { ascending: false }),
        supabase.from('user_achievements').select('code', { count: 'exact', head: true }).eq('user_id', userId),
        supabase.from('achievements').select('code', { count: 'exact', head: true }),
      ]);
      const favIds = (unwrap(favs) as { character_id: string }[]).map((f) => f.character_id);
      const favCards = favIds.length ? ((unwrap(await supabase.from('character_cards').select('*').in('id', favIds)) as CharacterCard[]) ?? []) : [];
      return {
        mine: (unwrap(mine) as CharacterCard[]) ?? [],
        favorites: favIds.map((id) => favCards.find((c) => c.id === id)).filter(Boolean) as CharacterCard[],
        stats: ((unwrap(stats) as { conversations: number; likes: number }[]) ?? [])[0] ?? { conversations: 0, likes: 0 },
        collections: (cols.data as { id: string; name: string; item_count: number; is_public: boolean }[] | null) ?? [],
        badges: { got: badges.count ?? 0, total: allBadges.count ?? 0 },
      };
    },
    [userId],
    { refetchOnFocus: true },
  );

  if (!profile) return <Loading />;
  const premium = isPremiumActive(account);
  const list = tab === 'created' ? q.data?.mine : tab === 'favorites' ? q.data?.favorites : [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <TopBar title="Perfil" right={<IconButton icon="settings-outline" onPress={() => router.push('/settings')} label="Configurações" />} />
      <Screen
        refreshControl={
          <RefreshControl
            refreshing={q.refreshing}
            onRefresh={() => {
              void refreshAuth();
              void q.refresh();
            }}
            tintColor={colors.accent}
          />
        }
      >
        <View style={{ maxWidth: 720, width: '100%', alignSelf: 'center' }}>
          <Row gap={space.lg}>
            <Avatar path={profile.avatar_path} name={profile.display_name} size={80} ring />
            <View style={{ flex: 1 }}>
              <Text style={type.h1} numberOfLines={1}>
                {profile.display_name}
              </Text>
              <PremiumBadge until={profile.premium_until} size="md" />
              <Text style={type.small}>@{profile.username}</Text>
            </View>
          </Row>
          {profile.bio ? <Text style={[type.body, { marginTop: space.md }]}>{profile.bio}</Text> : null}
          <Card style={{ flexDirection: 'row', marginTop: space.lg, paddingVertical: space.md }}>
            <Stat value={profile.character_count} label="Criações" />
            <Stat value={profile.follower_count} label="Seguidores" />
            <Stat value={profile.following_count} label="Seguindo" />
            <Stat value={Number(q.data?.stats.conversations ?? 0)} label="Conversas" />
          </Card>
          <Row style={{ marginTop: space.md }}>
            <Button title="Editar perfil" variant="secondary" small icon="pencil" onPress={() => router.push('/edit-profile')} style={{ flex: 1 }} />
            <Button title="Personas" variant="secondary" small icon="happy-outline" onPress={() => router.push('/personas')} style={{ flex: 1 }} />
          </Row>
          <Row style={{ marginTop: space.md }}>
            <Pressable onPress={() => router.push('/achievements')} style={({ pressed }) => [styles.tile, pressed && { opacity: 0.85 }]}>
              <Ionicons name="trophy-outline" size={20} color={colors.signal} />
              <View style={{ flex: 1 }}>
                <Text style={type.h3}>Conquistas</Text>
                <Text style={type.small}>{q.data ? `${q.data.badges.got} de ${q.data.badges.total}` : '…'}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.faint} />
            </Pressable>
            <Pressable onPress={() => router.push('/premium')} style={({ pressed }) => [{ flex: 1 }, pressed && { opacity: 0.85 }]}>
              <View style={[styles.tile, { borderWidth: 0, backgroundColor: colors.accent }]}>
                <Ionicons name="star" size={20} color="#fff" />
                <View style={{ flex: 1 }}>
                  <Text style={[type.h3, { color: '#fff' }]}>{premium ? 'Premium ativo' : 'Premium'}</Text>
                  <Text style={[type.small, { color: '#ffffffcc' }]}>{premium ? 'Ver ou somar tempo' : 'Ver planos'}</Text>
                </View>
              </View>
            </Pressable>
          </Row>
          <View style={{ marginTop: space.xl }}>
            <Segmented
              value={tab}
              onChange={setTab}
              options={[
                { value: 'created', label: 'Criados' },
                { value: 'favorites', label: 'Favoritos' },
                { value: 'collections', label: 'Coleções' },
              ]}
            />
          </View>
          <View style={{ marginTop: space.md }}>
            {q.loading ? (
              <Loading />
            ) : tab === 'collections' ? (
              q.data?.collections.length ? (
                q.data.collections.map((c) => (
                  <ListItem
                    key={c.id}
                    icon={c.is_public ? 'albums-outline' : 'lock-closed-outline'}
                    title={c.name}
                    subtitle={`${c.item_count} ${c.item_count === 1 ? 'personagem' : 'personagens'}${c.is_public ? '' : ' · privada'}`}
                    onPress={() => router.push(`/collection/${c.id}`)}
                  />
                ))
              ) : (
                <EmptyState icon="albums-outline" title="Nenhuma coleção" message="Abra um personagem e toque no ícone de coleção para montar listas como “Vilões favoritos”." />
              )
            ) : !list?.length ? (
              tab === 'created' ? (
                <EmptyState icon="sparkles-outline" title="Você ainda não criou nada" action="Criar personagem" onAction={() => router.push('/create')} />
              ) : (
                <EmptyState icon="bookmark-outline" title="Sem favoritos" message="Favorite personagens para encontrá-los aqui." />
              )
            ) : (
              list.map((c) => (
                <CharacterRow
                  key={c.id}
                  c={c}
                  right={
                    tab === 'created' ? (
                      <IconButton icon="create-outline" size={20} color={colors.muted} onPress={() => router.push({ pathname: '/create/editor', params: { id: c.id } })} label="Editar" />
                    ) : undefined
                  }
                />
              ))
            )}
          </View>
        </View>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSoft },
});
