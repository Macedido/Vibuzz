import { METERS, type MeterKey } from '@vibuzz/shared';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Avatar, EmptyState, ErrorState, Loading, Row, Screen } from '@/components/ui';
import { unwrap, useQuery } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';
import { brandGradient, colors, radius, space, type } from '@/lib/theme';
import { timeAgo } from '@/lib/types';

interface Rel {
  id: string;
  target_label: string;
  target_is_user: boolean;
  meters: Partial<Record<MeterKey, number>>;
  mood: string | null;
  updated_at: string;
  subject: { name: string; avatar_path: string | null } | null;
  events: { kind: string; state: string; change: string; created_at: string }[];
}

const RIVAL: [string, string] = ['#FF7A59', '#FF4D8D'];

function Meter({ label, value, rival }: { label: string; value: number; rival?: boolean }) {
  return (
    <View style={{ marginBottom: space.sm }}>
      <Row style={{ justifyContent: 'space-between', marginBottom: 4 }}>
        <Text style={[type.small, { color: colors.textSoft }]}>{label}</Text>
        <Text style={[type.small, { color: colors.text, fontWeight: '700' }]}>{Math.round(value)}</Text>
      </Row>
      <View style={styles.track}>
        <LinearGradient colors={rival ? RIVAL : [...brandGradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.fill, { width: `${Math.max(3, Math.min(100, value))}%` }]} />
      </View>
    </View>
  );
}

/** How each character feels about you in this story, and what changed it. */
export default function Relationship() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery(async () => {
    const rows = unwrap(
      await supabase
        .from('relationships')
        .select('id, target_label, target_is_user, meters, mood, updated_at, subject:characters!relationships_subject_character_id_fkey(name, avatar_path), events:relationship_events(kind, state, change, created_at)')
        .eq('conversation_id', id)
        .order('updated_at', { ascending: false }),
    ) as unknown as Rel[];
    return rows ?? [];
  }, [id]);
  if (q.loading) return <Loading />;
  if (q.error) return <ErrorState message={q.error} onRetry={q.refresh} />;
  const withUser = (q.data ?? []).filter((r) => r.target_is_user);
  const others = (q.data ?? []).filter((r) => !r.target_is_user);
  if (!withUser.length && !others.length) {
    return <EmptyState icon="heart-half-outline" title="A relação ainda está começando" message="Converse mais um pouco: amizade, confiança, intimidade e rivalidade aparecem aqui conforme a história acontece." />;
  }
  return (
    <Screen>
      <View style={{ maxWidth: 720, width: '100%', alignSelf: 'center', gap: space.lg }}>
        {withUser.map((r) => {
          const events = [...(r.events ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 6);
          return (
            <View key={r.id} style={styles.card}>
              <Row gap={space.md} style={{ marginBottom: space.md }}>
                <Avatar path={r.subject?.avatar_path} name={r.subject?.name} size={48} />
                <View style={{ flex: 1 }}>
                  <Text style={type.h2}>{r.subject?.name ?? 'Personagem'}</Text>
                  <Text style={[type.small, { color: colors.signal }]}>{r.mood ? `está ${r.mood}` : 'com você'}</Text>
                </View>
                <Text style={type.small}>{timeAgo(r.updated_at)}</Text>
              </Row>
              {Object.keys(r.meters ?? {}).length ? (
                METERS.map((m) => <Meter key={m.key} label={m.label} value={r.meters?.[m.key] ?? 0} rival={m.key === 'rivalidade'} />)
              ) : (
                <Text style={type.small}>Os medidores aparecem depois da próxima resposta.</Text>
              )}
              {events.length ? (
                <View style={{ marginTop: space.md, gap: space.sm }}>
                  <Text style={type.tiny}>O que aconteceu</Text>
                  {events.map((e, i) => (
                    <View key={i} style={styles.event}>
                      <Text style={[type.body, { fontSize: 14 }]}>{e.change || e.state}</Text>
                      <Text style={[type.small, { fontSize: 11 }]}>{timeAgo(e.created_at)}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}
        {others.length ? (
          <View style={styles.card}>
            <Text style={[type.tiny, { marginBottom: space.sm }]}>Entre os personagens</Text>
            {others.map((r) => (
              <View key={r.id} style={styles.event}>
                <Text style={type.h3}>
                  {r.subject?.name} → {r.target_label}
                </Text>
                <Text style={[type.small, { marginTop: 2 }]}>{[...(r.events ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]?.state ?? ''}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { padding: space.lg, borderRadius: radius.xl, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSoft },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.overlay, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  event: { paddingVertical: space.sm, borderTopWidth: 1, borderTopColor: colors.borderSoft },
});
