import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { CharacterGrid } from '@/components/character-card';
import { ActionSheet, Avatar, EmptyState, ErrorState, IconButton, Loading, Row, Screen } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { unwrap, useQuery } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';
import { colors, space, type } from '@/lib/theme';
import type { CharacterCard } from '@/lib/types';

interface Collection {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  is_public: boolean;
  item_count: number;
  owner: { username: string; display_name: string; avatar_path: string | null } | null;
}

/** A public (or own private) list of characters someone curated. */
export default function CollectionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useAuth();
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const q = useQuery(async () => {
    const col = unwrap(
      await supabase.from('collections').select('id, owner_id, name, description, is_public, item_count, owner:user_profiles!collections_owner_profile_fkey(username, display_name, avatar_path)').eq('id', id).maybeSingle(),
    ) as unknown as Collection | null;
    if (!col) return null;
    const { data: items } = await supabase.from('collection_items').select('character_id, added_at').eq('collection_id', id).order('added_at', { ascending: false }).limit(200);
    const ids = (items ?? []).map((i: { character_id: string }) => i.character_id);
    const cards = ids.length ? ((unwrap(await supabase.from('character_cards').select('*').in('id', ids)) as CharacterCard[]) ?? []) : [];
    const order = new Map(ids.map((x, i) => [x, i]));
    return { col, cards: cards.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)) };
  }, [id]);
  if (q.loading) return <Loading />;
  if (q.error) return <ErrorState message={q.error} onRetry={q.refresh} />;
  if (!q.data) return <EmptyState icon="albums-outline" title="Coleção não encontrada" message="Ela pode ter sido apagada ou ficado privada." />;
  const { col, cards } = q.data;
  const mine = col.owner_id === userId;

  const togglePublic = async () => {
    await supabase.from('collections').update({ is_public: !col.is_public }).eq('id', col.id);
    q.refresh();
  };
  const remove = async () => {
    await supabase.from('collections').delete().eq('id', col.id);
    router.back();
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: col.name, headerRight: mine ? () => <IconButton icon="ellipsis-horizontal" onPress={() => setMenu(true)} label="Opções" /> : undefined }} />
      <View style={{ marginBottom: space.lg }}>
        <Text style={type.h1}>{col.name}</Text>
        {col.description ? <Text style={[type.body, { marginTop: 4 }]}>{col.description}</Text> : null}
        <Row style={{ marginTop: space.sm }}>
          {col.owner ? (
            <Row gap={6}>
              <Avatar path={col.owner.avatar_path} name={col.owner.display_name} size={22} />
              <Text style={type.small} onPress={() => router.push(`/user/${col.owner_id}`)}>
                @{col.owner.username}
              </Text>
            </Row>
          ) : null}
          <Text style={type.small}>· {col.item_count} {col.item_count === 1 ? 'personagem' : 'personagens'}</Text>
          {!col.is_public ? <Text style={[type.small, { color: colors.signal }]}>· privada</Text> : null}
        </Row>
      </View>
      {cards.length ? <CharacterGrid items={cards} /> : <EmptyState icon="albums-outline" title="Coleção vazia" message="Abra um personagem e toque em “Salvar em coleção”." />}
      <ActionSheet
        visible={menu}
        onClose={() => setMenu(false)}
        actions={[
          { label: col.is_public ? 'Tornar privada' : 'Tornar pública', icon: col.is_public ? 'lock-closed-outline' : 'globe-outline', onPress: togglePublic },
          { label: 'Apagar coleção', icon: 'trash-outline', danger: true, onPress: remove },
        ]}
      />
    </Screen>
  );
}
