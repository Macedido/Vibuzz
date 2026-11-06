import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, Text, TextInput, View } from 'react-native';
import { Avatar, Banner, Button, Card, IconButton, ListItem, Panel, Row, Screen, Section, ToggleRow } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useQuery } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';
import { colors, radius, space, type } from '@/lib/theme';

interface Status {
  chat: boolean;
  embeddings: boolean;
  vision: boolean;
  moderation: string;
  missing: string[];
}

export default function Settings() {
  const router = useRouter();
  const { account, isAdult, refresh, signOut, userId } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const status = useQuery(() => api<Status>('/v1/status'), []);
  const usage = useQuery(() => api<{ messagesToday: number; dailyLimit: number }>('/v1/me/usage'), []);
  const blocked = useQuery(async () => {
    const { data } = await supabase.from('blocks').select('blocked_id, profile:user_profiles!blocks_blocked_profile_fkey(username, display_name, avatar_path)').eq('blocker_id', userId!);
    return (data as unknown as { blocked_id: string; profile: { username: string; display_name: string; avatar_path: string | null } | null }[]) ?? [];
  }, [userId]);

  const setMature = async (v: boolean) => {
    setError(null);
    try {
      await api('/v1/profile', { method: 'PATCH', body: { allowMature: v } });
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const setSpontaneous = async (v: boolean) => {
    await supabase.from('users').update({ spontaneous_messages: v }).eq('id', userId!);
    await refresh();
  };

  const deleteAccount = async () => {
    setDeleting(true);
    try {
      await api('/v1/account', { method: 'DELETE' });
      await signOut();
    } catch (e) {
      setError(errorMessage(e));
      setDeleting(false);
    }
  };

  const logout = () => {
    if (Platform.OS === 'web') return void signOut();
    Alert.alert('Sair', 'Deseja sair da sua conta?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Sair', style: 'destructive', onPress: () => void signOut() },
    ]);
  };

  return (
    <Screen>
      <View style={{ maxWidth: 720, width: '100%', alignSelf: 'center' }}>
        {error ? <Banner tone="danger" text={error} /> : null}

        <Section title="Conta" style={{ marginTop: 0 }}>
          <ListItem icon="person-outline" title="Editar perfil" onPress={() => router.push('/edit-profile')} />
          <ListItem icon="happy-outline" title="Personas" onPress={() => router.push('/personas')} />
          <ListItem icon="notifications-outline" title="Notificações" onPress={() => router.push('/notifications')} />
        </Section>

        <Section title="Conteúdo e privacidade">
          <ToggleRow
            title="Conteúdo adulto (18+)"
            subtitle={isAdult ? 'Mostra personagens classificados como 18+. Conteúdo sexual explícito nunca é permitido.' : 'Disponível apenas para contas de maiores de 18 anos.'}
            value={Boolean(account?.allow_mature)}
            onChange={setMature}
            disabled={!isAdult}
          />
          <ToggleRow
            title="Mensagens espontâneas"
            subtitle="Em breve: permitir que personagens mandem novidades por conta própria. Desligado por padrão; nada é enviado sem sua permissão."
            value={Boolean(account?.spontaneous_messages)}
            onChange={setSpontaneous}
          />
          <Text style={[type.tiny, { marginTop: space.md, marginBottom: space.sm }]}>Usuários bloqueados</Text>
          {blocked.data?.length ? (
            blocked.data.map((b) => (
              <Row key={b.blocked_id} style={{ paddingVertical: space.sm }}>
                <Avatar path={b.profile?.avatar_path} name={b.profile?.display_name} size={32} />
                <Text style={[type.body, { flex: 1 }]}>@{b.profile?.username ?? 'usuário'}</Text>
                <IconButton
                  icon="close-circle-outline"
                  color={colors.muted}
                  onPress={async () => {
                    await supabase.from('blocks').delete().eq('blocker_id', userId!).eq('blocked_id', b.blocked_id);
                    void blocked.reload();
                  }}
                  label="Desbloquear"
                />
              </Row>
            ))
          ) : (
            <Text style={type.small}>Ninguém bloqueado.</Text>
          )}
        </Section>

        <Section title="Uso">
          <Card style={{ padding: space.md }}>
            <Text style={type.body}>
              Mensagens hoje: <Text style={{ color: colors.text, fontWeight: '700' }}>{usage.data?.messagesToday ?? '—'}</Text> de {usage.data?.dailyLimit ?? '—'}
            </Text>
            {status.data ? (
              <Text style={[type.small, { marginTop: space.sm }]}>
                IA: {status.data.chat ? 'conectada' : 'não configurada'} · Memória semântica: {status.data.embeddings ? 'ativa' : 'por palavras-chave'} · Visão: {status.data.vision ? 'ativa' : 'indisponível'}
              </Text>
            ) : status.error ? (
              <Text style={[type.small, { color: colors.danger, marginTop: space.sm }]}>Servidor indisponível: {status.error}</Text>
            ) : null}
          </Card>
        </Section>

        <Section title="Sobre">
          <ListItem icon="document-text-outline" title="Termos de uso e privacidade" onPress={() => router.push('/legal')} />
          <ListItem icon="log-out-outline" title="Sair" onPress={logout} />
          <ListItem icon="trash-outline" title="Excluir conta" subtitle="Apaga tudo: personagens, conversas, memórias e arquivos" danger onPress={() => setDeleteOpen(true)} />
        </Section>
        <Text style={[type.small, { textAlign: 'center', marginTop: space.xl }]}>Vibuzz 1.0 · Create. Connect. Remember.</Text>
      </View>

      <Panel visible={deleteOpen} onClose={() => setDeleteOpen(false)} title="Excluir conta">
        <Text style={[type.body, { marginBottom: space.md }]}>
          Isso apaga permanentemente sua conta, personas, personagens, conversas, memórias, curtidas e imagens. Não dá para desfazer. Digite EXCLUIR para confirmar.
        </Text>
        <TextInput value={confirmText} onChangeText={setConfirmText} autoCapitalize="characters" style={{ height: 48, borderRadius: radius.md, backgroundColor: colors.raised, color: colors.text, paddingHorizontal: space.md, marginBottom: space.md }} />
        <Button title="Excluir definitivamente" variant="danger" loading={deleting} disabled={confirmText.trim() !== 'EXCLUIR'} onPress={deleteAccount} style={{ marginBottom: space.lg }} />
      </Panel>
    </Screen>
  );
}
