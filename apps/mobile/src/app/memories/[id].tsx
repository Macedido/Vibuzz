import { MEMORY_CATEGORIES, MEMORY_CATEGORY_LABELS, RELATIONSHIP_LABELS, type MemoryCategory, type RelationshipKind } from '@vibuzz/shared';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, Text, TextInput, View } from 'react-native';
import { ActionSheet, Banner, Button, Card, Chip, ChipScroller, EmptyState, ErrorState, IconButton, Loading, Panel, Row, Screen, Section } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { unwrap, useQuery } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';
import { colors, radius, space, type } from '@/lib/theme';
import { timeAgo, type MemoryRow } from '@/lib/types';

interface Relationship {
  id: string;
  target_label: string;
  subject: { name: string } | null;
  events: { kind: string; state: string; created_at: string }[];
}

export default function Memories() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [filter, setFilter] = useState<MemoryCategory | 'all'>('all');
  const [menu, setMenu] = useState<MemoryRow | null>(null);
  const [editing, setEditing] = useState<MemoryRow | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const q = useQuery(async () => {
    const [mems, rels, members] = await Promise.all([
      supabase
        .from('memories')
        .select('id, category, content, importance, status, holder_character_id, edited_by_user, created_at')
        .eq('conversation_id', id)
        .order('importance', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(500),
      supabase
        .from('relationships')
        .select('id, target_label, subject:characters!relationships_subject_character_id_fkey(name), events:relationship_events(kind, state, created_at)')
        .eq('conversation_id', id),
      supabase.from('conversation_members').select('character:characters(id, name)').eq('conversation_id', id),
    ]);
    const names = new Map<string, string>(
      ((members.data as unknown as { character: { id: string; name: string } | null }[]) ?? []).filter((m) => m.character).map((m) => [m.character!.id, m.character!.name]),
    );
    return { memories: (unwrap(mems) as MemoryRow[]) ?? [], relationships: (rels.data as unknown as Relationship[]) ?? [], names };
  }, [id]);

  const list = useMemo(() => (q.data?.memories ?? []).filter((m) => filter === 'all' || m.category === filter), [q.data, filter]);

  const save = async () => {
    if (!editing || !text.trim()) return;
    try {
      await api(`/v1/memories/${editing.id}`, { method: 'PATCH', body: { content: text.trim() } });
      setEditing(null);
      void q.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const remove = async (m: MemoryRow) => {
    q.setData((d) => d && { ...d, memories: d.memories.filter((x) => x.id !== m.id) });
    const { error } = await supabase.from('memories').delete().eq('id', m.id);
    if (error) {
      setError('Não foi possível apagar.');
      void q.reload();
    }
  };

  if (q.loading) return <Loading />;
  if (q.error || !q.data) return <ErrorState message={q.error ?? 'Erro'} onRetry={q.refresh} />;

  return (
    <Screen refreshControl={<RefreshControl refreshing={q.refreshing} onRefresh={q.refresh} tintColor={colors.accent} />}>
      <View style={{ maxWidth: 720, width: '100%', alignSelf: 'center' }}>
        <Text style={[type.body, { marginBottom: space.md }]}>
          O que o personagem lembra desta conversa. Memórias são privadas, só desta conversa, e vêm das mensagens. Corrija ou apague o que quiser — apagar uma mensagem também invalida as memórias dela.
        </Text>
        {error ? <Banner tone="danger" text={error} /> : null}
        <ChipScroller>
          <Chip label={`Todas · ${q.data.memories.length}`} active={filter === 'all'} onPress={() => setFilter('all')} />
          {MEMORY_CATEGORIES.map((c) => {
            const n = q.data!.memories.filter((m) => m.category === c).length;
            return n ? <Chip key={c} label={`${MEMORY_CATEGORY_LABELS[c]} · ${n}`} active={filter === c} onPress={() => setFilter(c)} /> : null;
          })}
        </ChipScroller>

        <View style={{ marginTop: space.lg, gap: space.sm }}>
          {!list.length ? (
            <EmptyState icon="bulb-outline" title="Nenhuma memória ainda" message="Converse um pouco: memórias importantes aparecem aqui alguns segundos depois." />
          ) : (
            list.map((m) => (
              <Card key={m.id} style={{ padding: space.md }}>
                <Row style={{ alignItems: 'flex-start' }}>
                  <View style={{ flex: 1 }}>
                    <Row gap={6} style={{ marginBottom: 4, flexWrap: 'wrap' }}>
                      <Text style={[type.tiny, { color: colors.signal }]}>{MEMORY_CATEGORY_LABELS[m.category as MemoryCategory] ?? m.category}</Text>
                      {m.holder_character_id ? <Text style={type.tiny}>· só {q.data!.names.get(m.holder_character_id) ?? 'um integrante'}</Text> : null}
                      {m.status === 'needs_rebuild' ? <Text style={[type.tiny, { color: colors.warning }]}>· atualizando</Text> : null}
                      {m.edited_by_user ? <Text style={type.tiny}>· editada</Text> : null}
                      <Text style={type.tiny}>· {timeAgo(m.created_at)}</Text>
                    </Row>
                    <Text style={type.body}>{m.content}</Text>
                    <View style={{ height: 3, backgroundColor: colors.overlay, borderRadius: radius.pill, marginTop: space.sm, overflow: 'hidden' }}>
                      <View style={{ width: `${Math.round(m.importance * 100)}%`, height: '100%', backgroundColor: colors.accent }} />
                    </View>
                  </View>
                  <IconButton icon="ellipsis-vertical" size={18} color={colors.muted} onPress={() => setMenu(m)} label="Opções" />
                </Row>
              </Card>
            ))
          )}
        </View>

        {q.data.relationships.length ? (
          <Section title="Relações">
            <View style={{ gap: space.sm }}>
              {q.data.relationships.map((r) => {
                const latest = [...(r.events ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
                if (!latest) return null;
                return (
                  <Card key={r.id} style={{ padding: space.md }}>
                    <Text style={type.h3}>
                      {r.subject?.name ?? 'Personagem'} → {r.target_label}
                    </Text>
                    <Text style={[type.tiny, { color: colors.signal, marginTop: 2 }]}>{RELATIONSHIP_LABELS[latest.kind as RelationshipKind] ?? latest.kind}</Text>
                    <Text style={[type.body, { marginTop: 4 }]}>{latest.state}</Text>
                  </Card>
                );
              })}
            </View>
          </Section>
        ) : null}
      </View>

      <ActionSheet
        visible={Boolean(menu)}
        onClose={() => setMenu(null)}
        actions={
          menu
            ? [
                { label: 'Corrigir', icon: 'create-outline', onPress: () => { setEditing(menu); setText(menu.content); } },
                { label: 'Apagar memória', icon: 'trash-outline', danger: true, onPress: () => remove(menu) },
              ]
            : []
        }
      />
      <Panel visible={Boolean(editing)} onClose={() => setEditing(null)} title="Corrigir memória">
        <TextInput
          value={text}
          onChangeText={setText}
          multiline
          maxLength={1000}
          style={{ minHeight: 110, backgroundColor: colors.raised, borderRadius: radius.md, color: colors.text, padding: space.md, textAlignVertical: 'top', marginBottom: space.md }}
        />
        <Button title="Salvar" onPress={save} disabled={!text.trim()} style={{ marginBottom: space.lg }} />
      </Panel>
    </Screen>
  );
}
