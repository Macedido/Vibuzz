import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';
import { config } from './config';

/**
 * Client uses the public anon key; Row Level Security in the database decides
 * what each user can read or write. Only the auth session is kept on device.
 */
export const supabase = createClient(config.supabaseUrl || 'http://localhost', config.supabaseAnonKey || 'missing', {
  auth: {
    storage: Platform.OS === 'web' ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
});

if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

const publicUrlCache = new Map<string, string>();

/** Public URL for files in the `media` bucket (avatars, character images). */
export function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  let url = publicUrlCache.get(path);
  if (!url) {
    url = supabase.storage.from('media').getPublicUrl(path).data.publicUrl;
    publicUrlCache.set(path, url);
  }
  return url;
}

const signedCache = new Map<string, { url: string; exp: number }>();

/** Signed URL for private chat images. */
export async function chatImageUrl(path: string): Promise<string | null> {
  const hit = signedCache.get(path);
  if (hit && hit.exp > Date.now()) return hit.url;
  const { data } = await supabase.storage.from('chat').createSignedUrl(path, 3600);
  if (!data?.signedUrl) return null;
  signedCache.set(path, { url: data.signedUrl, exp: Date.now() + 3500_000 });
  return data.signedUrl;
}
