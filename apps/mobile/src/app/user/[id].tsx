import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { CharacterGrid } from '@/components/character-card';
import { ActionSheet, Avatar, Button, Card, EmptyState, ErrorState, IconButton, Loading, Row, Screen, Section } from '@/components/ui';
import { useAuth, type Profile } from '@/lib/auth';
import { unwrap, useQuery } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';
import { space, type } from '@/lib/theme';
import { compact, type CharacterCard } from '@/lib/types';

export default function UserPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { userId } = useAuth();
  const [menu, setMenu] = useState(false);
  const q = useQuery(async () => {
    const profile = unwrap(await supabase.from('user_profiles').select('*').eq('id', id).maybeSingle()) as Profile | null;
    if (!profile) throw new Error('Perfil indisponível.');
    const [chars, follow, blocked] = await Promise.all([
      supabase.rpc('discover_characters', { p_creator: id, p_sort: 'recent', p_limit: 50 }),
      supabase.from('follows').select('follower_id').eq('follower_id', userId!).eq('following_id', id).maybeSingle(),
      supabase.from('blocks').select('blocked_id').eq('blocker_id', userId!).eq('blocked_id', id).maybeSingle(),
    ]);
    return { profile, characters: (unwrap(chars) as CharacterCard[]) ?? [], following: Boolean(follow.data), blocked: Boolean(blocked.data) };
  }, [id, userId]);

  if (q.loading) return <Loading />;
  if (q.error || !q.data) return <ErrorState message={q.error ?? 'Erro'} onRetry={q.refresh} />;
  const { profile, characters, following, blocked } = q.data;
  const me = id === userId;

  const toggleFollow = async () => {
    q.setData((d) => d && { ...d, following: !following, profile: { ...d.profile, follower_count: d.profile.follower_count + (following ? -1 : 1) } });
    if (following) await supabase.from('follows').delete().eq('follower_id', userId!).eq('following_id', id);
    else await supabase.from('follows').insert({ follower_id: userId, following_id: id });
  };
  const toggleBlock = async () => {
    if (blocked) await supabase.from('blocks').delete().eq('blocker_id', userId!).eq('blocked_id', id);
    else {
      await supabase.from('blocks').insert({ blocker_id: userId, blocked_id: id });
      await supabase.from('follows').delete().eq('follower_id', userId!).eq('following_id', id);
    }
    void q.reload();
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: `@${profile.username}`, headerRight: me ? undefined : () => <IconButton icon="ellipsis-horizontal" onPress={() => setMenu(true)} label="Mais" /> }} />
      <View style={{ maxWidth: 900, width: '100%', alignSelf: 'center' }}>
        <Row gap={space.lg}>
          <Avatar path={profile.avatar_path} name={profile.display_name} size={80} />
          <View style={{ flex: 1 }}>
            <Text style={type.h1}>{profile.display_name}</Text>
            <Text style={type.small}>@{profile.username}</Text>
          </View>
        </Row>
        {profile.bio ? <Text style={[type.body, { marginTop: space.md }]}>{profile.bio}</Text> : null}
        <Card style={{ flexDirection: 'row', marginTop: space.lg, paddingVertical: space.md }}>
          {[
            [profile.character_count, 'Criações'],
            [profile.follower_count, 'Seguidores'],
            [profile.following_count, 'Seguindo'],
          ].map(([v, l]) => (
            <View key={l as string} style={{ flex: 1, alignItems: 'center' }}>
              <Text style={type.h2}>{compact(v as number)}</Text>
              <Text style={type.small}>{l}</Text>
            </View>
          ))}
        </Card>
        {!me ? (
          <Button
            title={blocked ? 'Desbloquear' : following ? 'Seguindo' : 'Seguir'}
            variant={following || blocked ? 'secondary' : 'primary'}
            icon={following ? 'checkmark' : 'person-add-outline'}
            onPress={blocked ? toggleBlock : toggleFollow}
            style={{ marginTop: space.md }}
          />
        ) : (
          <Button title="Editar perfil" variant="secondary" onPress={() => router.push('/edit-profile')} style={{ marginTop: space.md }} />
        )}
        <Section title="Personagens">{characters.length ? <CharacterGrid items={characters} /> : <EmptyState title="Nenhum personagem público" />}</Section>
      </View>
      <ActionSheet
        visible={menu}
        onClose={() => setMenu(false)}
        actions={[
          { label: blocked ? 'Desbloquear' : 'Bloquear', icon: 'ban-outline', danger: !blocked, onPress: toggleBlock },
          { label: 'Denunciar perfil', icon: 'flag-outline', danger: true, onPress: () => router.push({ pathname: '/report', params: { type: 'user', id } }) },
        ]}
      />
    </Screen>
  );
}
