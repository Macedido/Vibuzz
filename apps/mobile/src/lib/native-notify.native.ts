import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { supabase } from './supabase';

/**
 * Android/iOS app notifications without a push server: a background task wakes
 * up (about every 15 minutes, decided by the OS), looks for new notifications of
 * this account and shows them as local notifications. Works without Firebase.
 */
const TASK = 'vibuzz-check-notifications';
const SEEN_KEY = 'vibuzz.notifications.seenAt';
const CHANNEL = 'mensagens';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

interface Row {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

function content(n: Row): { title: string; body: string; url: string } | null {
  const p = n.payload ?? {};
  const s = (k: string) => (typeof p[k] === 'string' ? (p[k] as string) : '');
  switch (n.type) {
    case 'message':
      return { title: s('name') || 'Nova mensagem', body: p.photo ? `📷 ${s('preview') || 'Mandou uma foto'}` : s('preview') || 'Mandou uma mensagem', url: `/chat/${s('conversationId')}` };
    case 'system':
      return s('title') ? { title: s('title'), body: s('body'), url: '/notifications' } : null;
    case 'achievement':
      return { title: 'Conquista desbloqueada', body: s('title'), url: '/achievements' };
    case 'follow':
      return { title: 'Novo seguidor', body: 'Alguém começou a seguir você.', url: '/notifications' };
    case 'comment':
      return { title: 'Novo comentário', body: s('preview') || 'Comentaram no seu personagem.', url: '/notifications' };
    default:
      return null;
  }
}

/** Shows notifications created since the last check. Returns how many were shown. */
export async function checkNotifications(): Promise<number> {
  const { data: auth } = await supabase.auth.getSession();
  const session = auth.session;
  if (!session) return 0;
  const seen = (await AsyncStorage.getItem(SEEN_KEY)) ?? new Date(Date.now() - 2 * 3600_000).toISOString();
  const { data } = await supabase
    .from('notifications')
    .select('id, type, payload, created_at')
    .eq('user_id', session.user.id)
    .is('read_at', null)
    .gt('created_at', seen)
    .order('created_at', { ascending: true })
    .limit(6);
  const rows = (data as Row[] | null) ?? [];
  let shown = 0;
  for (const n of rows) {
    const c = content(n);
    if (!c) continue;
    await Notifications.scheduleNotificationAsync({ content: { title: c.title, body: c.body, data: { url: c.url } }, trigger: null });
    shown++;
  }
  if (rows.length) await AsyncStorage.setItem(SEEN_KEY, rows[rows.length - 1].created_at);
  return shown;
}

TaskManager.defineTask(TASK, async () => {
  try {
    await checkNotifications();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export function nativeNotificationsSupported(): boolean {
  return true;
}

export async function enableNativeNotifications(): Promise<'on' | 'denied'> {
  const perm = await Notifications.requestPermissionsAsync();
  if (!perm.granted) return 'denied';
  await Notifications.setNotificationChannelAsync(CHANNEL, { name: 'Mensagens dos personagens', importance: Notifications.AndroidImportance.HIGH });
  if (!(await AsyncStorage.getItem(SEEN_KEY))) await AsyncStorage.setItem(SEEN_KEY, new Date().toISOString());
  if (!(await TaskManager.isTaskRegisteredAsync(TASK))) await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: 15 });
  return 'on';
}

export async function disableNativeNotifications(): Promise<void> {
  if (await TaskManager.isTaskRegisteredAsync(TASK)) await BackgroundTask.unregisterTaskAsync(TASK);
}

export async function nativeNotificationsOn(): Promise<boolean> {
  const perm = await Notifications.getPermissionsAsync();
  return perm.granted && (await TaskManager.isTaskRegisteredAsync(TASK));
}

/** Opens the right screen when a notification is tapped. Returns an unsubscribe function. */
export function onNotificationTap(open: (url: string) => void): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((r) => {
    const url = r.notification.request.content.data?.url;
    if (typeof url === 'string' && url.startsWith('/')) open(url);
  });
  return () => sub.remove();
}
