/** Web build: notifications go through Web Push (see pwa.ts); these are no-ops. */
export async function checkNotifications(): Promise<number> {
  return 0;
}
export function nativeNotificationsSupported(): boolean {
  return false;
}
export async function enableNativeNotifications(): Promise<'on' | 'denied'> {
  return 'denied';
}
export async function disableNativeNotifications(): Promise<void> {}
export async function nativeNotificationsOn(): Promise<boolean> {
  return false;
}
export function onNotificationTap(_open: (url: string) => void): () => void {
  return () => {};
}
