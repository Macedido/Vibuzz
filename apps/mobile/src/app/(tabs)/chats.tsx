import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { ActionSheet, Avatar, Chip, ChipScroller, EmptyState, ErrorState, Ionicons, Loading, Row, Screen, TopBar } from '@/components/ui';
import { unwrap, useQuery } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';
import { colors, radius, space, type } from '@/lib/theme';
import { timeAgo, type ConversationItem } from '@/lib/types';

type Filter = 'recent' | 'favorites' | 'groups' | 'archived';

export default function Chats() {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('recent');
  const [search, setSearch] = useState('');
  const [menu, setMenu] = useState<ConversationItem | null>(null);
  const q = useQuery(
    async () =>
      (unwrap(
        await supabase
          .from('conversations')
          .select('id, title, character_id, persona_id, is_favorite, is_archived, creativity, last_message_at, last_message_preview, active_leaf_id, character:characters(id, name, avatar_path, kind)')
          .order('last_message_at', { ascending: false })
          .limit(300),
      ) as unknown as ConversationItem[]) ?? [],
    [],
    { refetchOnFocus: true },
  );

  const list = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data ?? []).filter((c) => {
      if (filter === 'archived' ? !c.is_archived : c.is_archived) return false;
      if (filter === 'favorites' && !c.is_favorite) return false;
      if (filter === 'groups' && c.character?.kind !== 'group') return false;
      if (!s) return true;
      return [c.title, c.character?.name, c.last_message_preview].some((t) => t?.toLowerCase().includes(s));
    });
  }, [q.data, filter, search]);

  const patch = async (c: ConversationItem, values: Partial<ConversationItem>) => {
    q.setData((rows) => (rows ?? []).map((r) => (r.id === c.id ? { ...r, ...values } : r)));
    await supabase.from('conversations').update(values).eq('id', c.id);
  };
  const remove = async (c: ConversationItem) => {
    q.setData((rows) => (rows ?? []).filter((r) => r.id !== c.id));
    await supabase.from('conversations').delete().eq('id', c.id);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <TopBar title="Conversas" />
      <View style={{ paddingHorizontal: space.lg, gap: space.md, paddingBottom: space.sm }}>
        <Row style={styles.search}>
          <Ionicons name="search" size={18} color={colors.muted} />
          <TextInput value={search} onChangeText={setSearch} placeholder="Pesquisar conversas" placeholderTextColor={colors.faint} style={{ flex: 1, height: 44, color: colors.text }} />
        </Row>
        <ChipScroller>
          <Chip label="Recentes" active={filter === 'recent'} onPress={() => setFilter('recent')} />
          <Chip label="Favoritas" icon="star" active={filter === 'favorites'} onPress={() => setFilter('favorites')} />
          <Chip label="Grupos" icon="people" active={filter === 'groups'} onPress={() => setFilter('groups')} />
          <Chip label="Arquivadas" icon="archive" active={filter === 'archived'} onPress={() => setFilter('archived')} />
        </ChipScroller>
      </View>
      {q.loading ? (
        <Loading />
      ) : q.error ? (
        <ErrorState message={q.error} onRetry={q.refresh} />
      ) : (
        <Screen padded={false} style={{ paddingHorizontal: space.lg }} refreshControl={<RefreshControl refreshing={q.refreshing} onRefresh={q.refresh} tintColor={colors.accent} />}>
          {!list.length ? (
            <EmptyState
              icon="chatbubbles-outline"
              title={filter === 'recent' && !search ? 'Nenhuma conversa ainda' : 'Nada aqui'}
              message={filter === 'recent' && !search ? 'Encontre um personagem e comece a conversar.' : undefined}
              action={filter === 'recent' && !search ? 'Descobrir personagens' : undefined}
              onAction={() => router.push('/discover')}
            />
          ) : (
            list.map((c) => (
              <Pressable key={c.id} onPress={() => router.push(`/chat/${c.id}`)} onLongPress={() => setMenu(c)} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.raised }]}>
                <Avatar path={c.character?.avatar_path} name={c.character?.name ?? c.title} size={52} />
                <View style={{ flex: 1 }}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Row gap={4} style={{ flex: 1 }}>
                      {c.is_favorite ? <Ionicons name="star" size={13} color={colors.accent} /> : null}
                      {c.character?.kind === 'group' ? <Ionicons name="people" size={13} color={colors.signal} /> : null}
                      <Text style={type.h3} numberOfLines={1}>
                        {c.title || c.character?.name || 'Conversa'}
                      </Text>
                    </Row>
                    <Text style={type.small}>{timeAgo(c.last_message_at)}</Text>
                  </Row>
                  <Text style={type.small} numberOfLines={1}>
                    {c.last_message_preview || '…'}
                  </Text>
                </View>
                <Pressable hitSlop={10} onPress={() => setMenu(c)}>
                  <Ionicons name="ellipsis-vertical" size={18} color={colors.faint} />
                </Pressable>
              </Pressable>
            ))
          )}
        </Screen>
      )}
      <ActionSheet
        visible={Boolean(menu)}
        onClose={() => setMenu(null)}
        title={menu?.title}
        actions={
          menu
            ? [
                { label: menu.is_favorite ? 'Remover dos favoritos' : 'Favoritar', icon: 'star-outline', onPress: () => patch(menu, { is_favorite: !menu.is_favorite }) },
                { label: menu.is_archived ? 'Desarquivar' : 'Arquivar', icon: 'archive-outline', onPress: () => patch(menu, { is_archived: !menu.is_archived }) },
                { label: 'Memórias', icon: 'bulb-outline', onPress: () => router.push(`/memories/${menu.id}`) },
                { label: 'Apagar conversa e memórias', icon: 'trash-outline', danger: true, onPress: () => remove(menu) },
              ]
            : []
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  search: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm + 2, paddingHorizontal: space.xs, borderRadius: radius.md },
});
