import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { ErrorState, Ionicons, Loading, Row, Screen, type IconName } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { unwrap, useQuery } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';
import { colors, radius, space, type } from '@/lib/theme';

interface Achievement {
  code: string;
  title: string;
  description: string;
  icon: IconName;
  metric: string;
  threshold: number;
}

/** Badges for creating, chatting and exploring, with progress toward the next ones. */
export default function Achievements() {
  const params = useLocalSearchParams<{ user?: string }>();
  const { userId } = useAuth();
  const who = params.user ?? userId ?? '';
  const q = useQuery(async () => {
    const [all, mine, stats] = await Promise.all([
      supabase.from('achievements').select('*').order('sort'),
      supabase.from('user_achievements').select('code, unlocked_at').eq('user_id', who),
      supabase.from('user_stats').select('*').eq('user_id', who).maybeSingle(),
    ]);
    return {
      all: (unwrap(all) as Achievement[]) ?? [],
      unlocked: new Map(((mine.data as { code: string; unlocked_at: string }[]) ?? []).map((r) => [r.code, r.unlocked_at])),
      stats: (stats.data as Record<string, number> | null) ?? {},
    };
  }, [who]);
  if (q.loading) return <Loading />;
  if (q.error || !q.data) return <ErrorState message={q.error ?? 'Erro'} onRetry={q.refresh} />;
  const { all, unlocked, stats } = q.data;
  return (
    <Screen>
      <View style={{ maxWidth: 720, width: '100%', alignSelf: 'center' }}>
        <Text style={[type.body, { marginBottom: space.lg }]}>
          {unlocked.size} de {all.length} conquistas desbloqueadas
        </Text>
        <View style={{ gap: space.sm }}>
          {all.map((a) => {
            const done = unlocked.has(a.code);
            const value = Math.min(a.threshold, Number(stats[a.metric] ?? 0));
            return (
              <View key={a.code} style={[styles.row, done && { borderColor: colors.accent + '66' }]}>
                <View style={[styles.badge, done ? { backgroundColor: colors.accent } : { backgroundColor: colors.overlay }]}>
                  <Ionicons name={a.icon} size={20} color={done ? '#fff' : colors.faint} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[type.h3, !done && { color: colors.textSoft }]}>{a.title}</Text>
                  <Text style={type.small}>{a.description}</Text>
                  {!done ? (
                    <View style={styles.track}>
                      <View style={[styles.fill, { width: `${(value / a.threshold) * 100}%` }]} />
                    </View>
                  ) : null}
                </View>
                <Row gap={4}>
                  {done ? <Ionicons name="checkmark-circle" size={20} color={colors.success} /> : <Text style={type.small}>{`${value}/${a.threshold}`}</Text>}
                </Row>
              </View>
            );
          })}
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSoft },
  badge: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  track: { height: 5, borderRadius: 3, backgroundColor: colors.overlay, marginTop: 6, overflow: 'hidden' },
  fill: { height: 5, borderRadius: 3, backgroundColor: colors.accent },
});
