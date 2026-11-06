import { CATEGORIES, DISCOVER_SORTS, SORT_LABELS, type DiscoverSort } from '@vibuzz/shared';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { CharacterGrid } from '@/components/character-card';
import { Chip, ChipScroller, EmptyState, ErrorState, Ionicons, Row, Screen, TopBar } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useDebounced } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';
import { colors, radius, space, type } from '@/lib/theme';
import type { CharacterCard } from '@/lib/types';

const PAGE = 24;

export default function Discover() {
  const params = useLocalSearchParams<{ sort?: string; category?: string; kind?: string; q?: string }>();
  const [query, setQuery] = useState(params.q ?? '');
  const [sort, setSort] = useState<DiscoverSort>((DISCOVER_SORTS as readonly string[]).includes(params.sort ?? '') ? (params.sort as DiscoverSort) : 'popular');
  const [category, setCategory] = useState<string | null>(params.category ?? null);
  const [groupsOnly, setGroupsOnly] = useState(params.kind === 'group');
  const [items, setItems] = useState<CharacterCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const q = useDebounced(query.trim(), 350);

  useEffect(() => {
    if (params.category !== undefined) setCategory(params.category || null);
    if (params.sort && (DISCOVER_SORTS as readonly string[]).includes(params.sort)) setSort(params.sort as DiscoverSort);
    if (params.kind !== undefined) setGroupsOnly(params.kind === 'group');
  }, [params.category, params.sort, params.kind]);

  const load = async (offset: number) => {
    setLoading(true);
    setError(null);
    const tagQuery = q.startsWith('#') ? q.slice(1).toLowerCase() : null;
    const { data, error } = await supabase.rpc('discover_characters', {
      p_query: tagQuery ? null : q || null,
      p_tags: tagQuery ? [tagQuery] : null,
      p_category: category,
      p_sort: sort,
      p_kind: groupsOnly ? 'group' : null,
      p_limit: PAGE,
      p_offset: offset,
    });
    setLoading(false);
    if (error) return setError(errorMessage(error));
    const rows = (data as CharacterCard[]) ?? [];
    setItems((prev) => (offset ? [...prev, ...rows.filter((r) => !prev.some((p) => p.id === r.id))] : rows));
    setMore(rows.length === PAGE);
  };

  useEffect(() => {
    void load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, sort, category, groupsOnly]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <TopBar title="Descobrir" />
      <View style={{ paddingHorizontal: space.lg, gap: space.md, paddingBottom: space.sm }}>
        <Row style={{ backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: space.md }}>
          <Ionicons name="search" size={18} color={colors.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Nome, descrição, @criador ou #tag"
            placeholderTextColor={colors.faint}
            style={{ flex: 1, height: 46, color: colors.text, fontSize: 15 }}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={10}>
              <Ionicons name="close-circle" size={18} color={colors.muted} />
            </Pressable>
          ) : null}
        </Row>
        <ChipScroller>
          {DISCOVER_SORTS.map((s) => (
            <Chip key={s} label={SORT_LABELS[s]} active={sort === s} onPress={() => setSort(s)} />
          ))}
          <Chip label="Grupos" icon="people" active={groupsOnly} onPress={() => setGroupsOnly((g) => !g)} />
        </ChipScroller>
        <ChipScroller>
          <Chip label="Todas" active={!category} onPress={() => setCategory(null)} />
          {CATEGORIES.map((c) => (
            <Chip key={c.slug} label={c.name} active={category === c.slug} onPress={() => setCategory(category === c.slug ? null : c.slug)} />
          ))}
        </ChipScroller>
      </View>
      <Screen padded={false} style={{ paddingHorizontal: space.lg, paddingTop: space.sm }}>
        {error ? (
          <ErrorState message={error} onRetry={() => load(0)} />
        ) : !loading && !items.length ? (
          <EmptyState icon="search-outline" title="Nada encontrado" message="Tente outra palavra, categoria ou filtro." />
        ) : (
          <>
            <CharacterGrid items={items} />
            {loading ? <ActivityIndicator color={colors.accent} style={{ marginTop: space.lg }} /> : null}
            {!loading && more ? (
              <Pressable onPress={() => load(items.length)} style={{ padding: space.lg, alignItems: 'center' }}>
                <Text style={[type.body, { color: colors.accent, fontWeight: '600' }]}>Carregar mais</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </Screen>
    </View>
  );
}
