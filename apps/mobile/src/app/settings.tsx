import { isPremiumActive } from '@vibuzz/shared';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import * as Linking from 'expo-linking';
import { Alert, Platform, Text, TextInput, View } from 'react-native';
import { Avatar, Banner, Button, Card, IconButton, ListItem, Panel, Row, Screen, Section, ToggleRow } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useQuery } from '@/lib/hooks';
import { checkNotifications, disableNativeNotifications, enableNativeNotifications, nativeNotificationsOn, nativeNotificationsSupported } from '@/lib/native-notify';
import { canInstall, disablePush, enablePush, isPushOn, onInstallAvailable, promptInstall, pushSupported } from '@/lib/pwa';
import { supabase } from '@/lib/supabase';
import { colors, radius, space, type } from '@/lib/theme';

const APK_URL = 'https://github.com/Macedido/Vibuzz/releases/latest/download/vibuzz.apk';

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
  const setFlag = async (column: 'spontaneous_messages' | 'voice_enabled' | 'private_mode', v: boolean) => {
    setError(null);
    const { error: e } = await supabase.from('users').update({ [column]: v }).eq('id', userId!);
    if (e) setError('Não foi possível salvar agora.');
    await refresh();
  };

  // Notifications on this device: Web Push in the browser / installed site, background checks in the app.
  const native = nativeNotificationsSupported();
  const webPush = pushSupported();
  const [notifOn, setNotifOn] = useState(false);
  const [notifBusy, setNotifBusy] = useState(false);
  const [notifMsg, setNotifMsg] = useState<string | null>(null);
  const [installable, setInstallable] = useState(canInstall());
  useEffect(() => {
    void (native ? nativeNotificationsOn() : isPushOn()).then(setNotifOn).catch(() => {});
    return onInstallAvailable(() => setInstallable(true));
  }, [native]);
  const toggleNotifications = async (v: boolean) => {
    setNotifBusy(true);
    setNotifMsg(null);
    try {
      if (v) {
        const r = native ? await enableNativeNotifications() : await enablePush();
        setNotifOn(r === 'on');
        if (r === 'denied') setNotifMsg('Permissão negada. Libere as notificações do Vibuzz nas configurações do aparelho/navegador.');
        if (r === 'unsupported') setNotifMsg('Este navegador não aceita notificações. No iPhone, adicione o site à Tela de Início primeiro.');
        if (r === 'on' && !account?.spontaneous_messages) await setFlag('spontaneous_messages', true);
      } else {
        if (native) await disableNativeNotifications();
        else await disablePush();
        setNotifOn(false);
      }
    } catch (e) {
      setNotifMsg(errorMessage(e));
    } finally {
      setNotifBusy(false);
    }
  };
  const testNotification = async () => {
    setNotifMsg(null);
    try {
      const r = await api<{ delivered: number }>('/v1/push/test', { body: {} });
      if (native) {
        const shown = await checkNotifications();
        setNotifMsg(shown ? 'Pronto! Olhe a barra de notificações.' : 'Teste criado. Ele aparece na próxima checagem.');
      } else setNotifMsg(r.delivered ? 'Enviada! Deve aparecer em alguns segundos.' : 'Nenhum navegador inscrito ainda. Desligue e ligue de novo.');
    } catch (e) {
      setNotifMsg(errorMessage(e));
    }
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

        <Section title="Vida própria e voz">
          <ToggleRow
            title="Mensagens espontâneas"
            subtitle="Personagens podem mandar mensagem sozinhos nas conversas em que você ligar “Vida própria”. Só entre 8h e 22h, com limite diário."
            value={Boolean(account?.spontaneous_messages)}
            onChange={(v) => setFlag('spontaneous_messages', v)}
          />
          <ToggleRow
            title="Voz dos personagens"
            subtitle="Permite ouvir as respostas em voz alta e fazer chamadas de voz. Cada personagem tem a própria voz."
            value={Boolean(account?.voice_enabled)}
            onChange={(v) => setFlag('voice_enabled', v)}
          />
        </Section>

        <Section title="Notificações neste aparelho">
          {native || webPush ? (
            <>
              <ToggleRow
                title={native ? 'Notificações do app' : 'Notificações do navegador'}
                subtitle={native ? 'Avisa quando um personagem manda mensagem, mesmo com o app fechado (o Android checa a cada ~15 min).' : 'Avisa na hora quando um personagem manda mensagem, mesmo com a aba fechada.'}
                value={notifOn}
                onChange={toggleNotifications}
                disabled={notifBusy}
              />
              {notifOn ? <Button title="Mandar notificação de teste" small variant="secondary" icon="paper-plane-outline" onPress={testNotification} style={{ alignSelf: 'flex-start', marginTop: space.sm }} /> : null}
            </>
          ) : (
            <Text style={type.small}>Este navegador não aceita notificações. Use o Chrome, ou instale o app.</Text>
          )}
          {notifMsg ? <Text style={[type.small, { marginTop: space.sm, color: colors.signal }]}>{notifMsg}</Text> : null}
          {Platform.OS === 'web' ? (
            <View style={{ marginTop: space.md }}>
              {installable ? <ListItem icon="download-outline" title="Instalar o Vibuzz" subtitle="Abre como app, com ícone na tela inicial" onPress={() => void promptInstall().then(() => setInstallable(false))} /> : null}
              <ListItem icon="logo-android" title="Baixar APK para Android" subtitle="Versão nativa com notificações" onPress={() => Linking.openURL(APK_URL)} />
            </View>
          ) : null}
        </Section>

        <Section title="Seu plano">
          <ListItem icon="star-outline" title="Vibuzz Premium" subtitle={isPremiumActive(account) ? `Ativo${account?.premium_until ? ` até ${new Date(account.premium_until).toLocaleDateString('pt-BR')}` : ''}` : 'Mais mensagens, memória e fotos'} onPress={() => router.push('/premium')} />
          <ListItem icon="trophy-outline" title="Conquistas" onPress={() => router.push('/achievements')} />
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
            title="Modo privado"
            subtitle="Suas coleções somem do perfil público e suas conversas e curtidas não contam nos rankings."
            value={Boolean(account?.private_mode)}
            onChange={(v) => setFlag('private_mode', v)}
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
