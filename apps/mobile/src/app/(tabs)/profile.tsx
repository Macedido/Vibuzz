import { useRouter } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, Text, View } from 'react-native';
import { CharacterRow } from '@/components/character-card';
import { Avatar, Button, Card, EmptyState, IconButton, Loading, Row, Screen, Segmented, TopBar } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { unwrap, useQuery } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';
import { colors, space, type } from '@/lib/theme';
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
  const { profile, userId, refresh: refreshAuth } = useAuth();
  const [tab, setTab] = useState<'created' | 'favorites'>('created');
  const q = useQuery(
    async () => {
      if (!userId) return null;
      const [mine, favs, stats] = await Promise.all([
        supabase.from('character_cards').select('*').eq('creator_id', userId).neq('status', 'removed').order('created_at', { ascending: false }),
        supabase.from('favorites').select('character_id, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(100),
        supabase.rpc('creator_stats', { p_user: userId }),
      ]);
      const favIds = (unwrap(favs) as { character_id: string }[]).map((f) => f.character_id);
      const favCards = favIds.length ? ((unwrap(await supabase.from('character_cards').select('*').in('id', favIds)) as CharacterCard[]) ?? []) : [];
      return {
        mine: (unwrap(mine) as CharacterCard[]) ?? [],
        favorites: favIds.map((id) => favCards.find((c) => c.id === id)).filter(Boolean) as CharacterCard[],
        stats: ((unwrap(stats) as { conversations: number; likes: number }[]) ?? [])[0] ?? { conversations: 0, likes: 0 },
      };
    },
    [userId],
    { refetchOnFocus: true },
  );

  if (!profile) return <Loading />;
  const list = tab === 'created' ? q.data?.mine : q.data?.favorites;

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
          <View style={{ marginTop: space.xl }}>
            <Segmented
              value={tab}
              onChange={setTab}
              options={[
                { value: 'created', label: 'Criados' },
                { value: 'favorites', label: 'Favoritos' },
              ]}
            />
          </View>
          <View style={{ marginTop: space.md }}>
            {q.loading ? (
              <Loading />
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
