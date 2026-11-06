/** Public configuration. Values are inlined at build time by Expo (EXPO_PUBLIC_*). */
export const config = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  apiUrl: (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/+$/, ''),
};

/**
 * Supabase is required for the app to open at all. The API URL is not: without
 * it people can still sign in, browse and manage personas, and AI actions show
 * a clear "not configured" message.
 */
export function missingConfig(): string[] {
  const out: string[] = [];
  if (!config.supabaseUrl) out.push('EXPO_PUBLIC_SUPABASE_URL');
  if (!config.supabaseAnonKey) out.push('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  return out;
}
