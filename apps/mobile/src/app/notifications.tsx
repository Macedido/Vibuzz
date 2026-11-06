import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { RefreshControl, Text, View } from 'react-native';
import { EmptyState, ErrorState, Ionicons, ListItem, Loading, Screen } from '@/components/ui';
import { unwrap, useQuery } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';
import { colors, type } from '@/lib/theme';
import { timeAgo } from '@/lib/types';

interface Notification {
  id: string;
  type: 'follow' | 'like' | 'comment' | 'moderation' | 'system';
  payload: { user_id?: string; character_id?: string; message?: string };
  read_at: string | null;
  created_at: string;
}

export default function Notifications() {
  const router = useRouter();
  const q = useQuery(async () => {
    const rows = (unwrap(await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(100)) as Notification[]) ?? [];
    const userIds = [...new Set(rows.map((r) => r.payload.user_id).filter(Boolean))] as string[];
    const { data: people } = userIds.length ? await supabase.from('user_profiles').select('id, username').in('id', userIds) : { data: [] };
    const names = new Map(((people as { id: string; username: string }[]) ?? []).map((p) => [p.id, p.username]));
    return { rows, names };
  }, []);

  useEffect(() => {
    if (q.data?.rows.some((r) => !r.read_at)) {
      void supabase.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null);
    }
  }, [q.data]);

  if (q.loading) return <Loading />;
  if (q.error || !q.data) return <ErrorState message={q.error ?? 'Erro'} onRetry={q.refresh} />;

  return (
    <Screen refreshControl={<RefreshControl refreshing={q.refreshing} onRefresh={q.refresh} tintColor={colors.accent} />}>
      {!q.data.rows.length ? (
        <EmptyState icon="notifications-outline" title="Tudo em dia" message="Novos seguidores e comentários aparecem aqui." />
      ) : (
        q.data.rows.map((n) => {
          const who = n.payload.user_id ? `@${q.data!.names.get(n.payload.user_id) ?? 'alguém'}` : '';
          const title = n.type === 'follow' ? `${who} começou a seguir você` : n.type === 'comment' ? `${who} comentou no seu personagem` : n.payload.message ?? 'Aviso do Vibuzz';
          return (
            <View key={n.id} style={{ opacity: n.read_at ? 0.7 : 1 }}>
              <ListItem
                icon={n.type === 'follow' ? 'person-add-outline' : n.type === 'comment' ? 'chatbubble-outline' : 'information-circle-outline'}
                title={title}
                subtitle={timeAgo(n.created_at)}
                onPress={() =>
                  n.payload.character_id ? router.push(`/character/${n.payload.character_id}`) : n.payload.user_id ? router.push(`/user/${n.payload.user_id}`) : undefined
                }
                right={!n.read_at ? <Ionicons name="ellipse" size={8} color={colors.accent} /> : <Text style={type.small} />}
              />
            </View>
          );
        })
      )}
    </Screen>
  );
}
