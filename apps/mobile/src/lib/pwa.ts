import { Platform } from 'react-native';
import { api } from './api';

/** Base path of the web build (GitHub Pages serves the app under /<repo>/). */
export function basePath(): string {
  if (typeof document === 'undefined') return '/';
  const src = [...document.scripts].map((s) => s.src).find((s) => s.includes('/_expo/static/'));
  if (!src) return '/';
  return new URL(src).pathname.split('/_expo/')[0] + '/';
}

let installEvent: { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> } | null = null;
const installListeners = new Set<() => void>();

/** Adds the manifest, theme color and service worker (web only, once). */
export function setupPwa() {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  const base = basePath();
  if (!document.querySelector('link[rel="manifest"]')) {
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = `${base}manifest.webmanifest`;
    document.head.appendChild(link);
    const theme = document.createElement('meta');
    theme.name = 'theme-color';
    theme.content = '#03041A';
    document.head.appendChild(theme);
    const apple = document.createElement('link');
    apple.rel = 'apple-touch-icon';
    apple.href = `${base}apple-touch-icon.png`;
    document.head.appendChild(apple);
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e as unknown as typeof installEvent;
    installListeners.forEach((l) => l());
  });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {});
}

export function canInstall(): boolean {
  return Boolean(installEvent);
}
export function onInstallAvailable(cb: () => void): () => void {
  installListeners.add(cb);
  return () => installListeners.delete(cb);
}
export async function promptInstall(): Promise<boolean> {
  if (!installEvent) return false;
  await installEvent.prompt();
  const choice = await installEvent.userChoice;
  installEvent = null;
  return choice.outcome === 'accepted';
}

export function pushSupported(): boolean {
  return Platform.OS === 'web' && typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function pushPermission(): NotificationPermission | 'unsupported' {
  return pushSupported() ? Notification.permission : 'unsupported';
}

function keyBytes(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Asks permission, subscribes this browser and saves it on the server. */
export async function enablePush(): Promise<'on' | 'denied' | 'unsupported'> {
  if (!pushSupported()) return 'unsupported';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return 'denied';
  const base = basePath();
  const reg = (await navigator.serviceWorker.getRegistration(base)) ?? (await navigator.serviceWorker.register(`${base}sw.js`, { scope: base }));
  await navigator.serviceWorker.ready;
  const { publicKey } = await api<{ publicKey: string }>('/v1/push/key', { method: 'GET' });
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) as unknown as BufferSource }));
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await api('/v1/push/subscribe', { body: { endpoint: json.endpoint, keys: json.keys } });
  return 'on';
}

export async function disablePush() {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration(basePath());
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api('/v1/push/unsubscribe', { body: { endpoint: sub.endpoint } }).catch(() => {});
    await sub.unsubscribe();
  }
}

export async function isPushOn(): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  const reg = await navigator.serviceWorker.getRegistration(basePath());
  return Boolean(await reg?.pushManager.getSubscription());
}
