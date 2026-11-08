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
  if (!document.getElementById('vibuzz-base-css')) {
    // Dark native controls and a slim scrollbar in the app's colors (the browser default is white).
    const style = document.createElement('style');
    style.id = 'vibuzz-base-css';
    style.textContent = `
      :root { color-scheme: dark; }
      html, body { background: #03041A; }
      * { scrollbar-width: thin; scrollbar-color: #2A3468 transparent; }
      ::-webkit-scrollbar { width: 10px; height: 10px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: #232C57; border-radius: 10px; border: 2px solid #03041A; }
      ::-webkit-scrollbar-thumb:hover { background: #34407A; }
      ::-webkit-scrollbar-corner { background: transparent; }
      ::selection { background: rgba(42, 125, 255, 0.45); }
    `;
    document.head.appendChild(style);
  }
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
