import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { ActionSheet, Avatar, Button, Card, EmptyState, ErrorState, IconButton, Loading, Row, Screen } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { unwrap, useQuery } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';
import { colors, space, type } from '@/lib/theme';
import type { Persona } from '@/lib/types';
import { useState } from 'react';

export default function Personas() {
  const router = useRouter();
  const { userId } = useAuth();
  const [menu, setMenu] = useState<Persona | null>(null);
  const q = useQuery(async () => (unwrap(await supabase.from('personas').select('*').order('created_at')) as Persona[]) ?? [], [], { refetchOnFocus: true });

  const duplicate = async (p: Persona) => {
    const { id: _id, is_default: _d, owner_id: _o, ...rest } = p;
    await supabase.from('personas').insert({ ...rest, name: `${p.name} (cópia)`.slice(0, 120), owner_id: userId });
    void q.reload();
  };
  const makeDefault = async (p: Persona) => {
    await supabase.from('personas').update({ is_default: false }).eq('owner_id', userId!).eq('is_default', true);
    await supabase.from('personas').update({ is_default: true }).eq('id', p.id);
    void q.reload();
  };
  const remove = async (p: Persona) => {
    await supabase.from('personas').delete().eq('id', p.id);
    void q.reload();
  };

  if (q.loading) return <Loading />;
  if (q.error) return <ErrorState message={q.error} onRetry={q.refresh} />;

  return (
    <Screen>
      <View style={{ maxWidth: 720, width: '100%', alignSelf: 'center' }}>
        <Text style={[type.body, { marginBottom: space.lg }]}>
          Personas são identidades fictícias que você usa nas histórias. Os personagens leem a persona escolhida em cada conversa — nunca os dados da sua conta.
        </Text>
        {!q.data?.length ? (
          <EmptyState icon="happy-outline" title="Nenhuma persona" message="Ex.: Alex, estudante de tecnologia · Lucas, detetive particular." />
        ) : (
          q.data.map((p) => (
            <Card key={p.id} onPress={() => router.push({ pathname: '/personas/edit', params: { id: p.id } })} style={{ marginBottom: space.sm, padding: space.md }}>
              <Row gap={space.md}>
                <Avatar path={p.avatar_path} name={p.name} size={48} />
                <View style={{ flex: 1 }}>
                  <Text style={type.h3}>
                    {p.name}
                    {p.is_default ? <Text style={[type.small, { color: colors.accent }]}>  · padrão</Text> : null}
                  </Text>
                  <Text style={type.small} numberOfLines={2}>
                    {p.biography || p.personality || 'Sem descrição'}
                  </Text>
                </View>
                <IconButton icon="ellipsis-vertical" size={18} color={colors.muted} onPress={() => setMenu(p)} label="Opções" />
              </Row>
            </Card>
          ))
        )}
        <Button title="Nova persona" icon="add" onPress={() => router.push('/personas/edit')} style={{ marginTop: space.lg }} />
      </View>
      <ActionSheet
        visible={Boolean(menu)}
        onClose={() => setMenu(null)}
        title={menu?.name}
        actions={
          menu
            ? [
                { label: 'Editar', icon: 'create-outline', onPress: () => router.push({ pathname: '/personas/edit', params: { id: menu.id } }) },
                { label: 'Duplicar', icon: 'copy-outline', onPress: () => duplicate(menu) },
                ...(!menu.is_default ? [{ label: 'Tornar padrão', icon: 'star-outline' as const, onPress: () => makeDefault(menu) }] : []),
                { label: 'Excluir', icon: 'trash-outline', danger: true, onPress: () => remove(menu) },
              ]
            : []
        }
      />
    </Screen>
  );
}
