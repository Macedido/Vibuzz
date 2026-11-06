/** Public configuration. Values are inlined at build time by Expo (EXPO_PUBLIC_*). */
export const config = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  apiUrl: (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/+$/, ''),
};

export function missingConfig(): string[] {
  const out: string[] = [];
  if (!config.supabaseUrl) out.push('EXPO_PUBLIC_SUPABASE_URL');
  if (!config.supabaseAnonKey) out.push('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  if (!config.apiUrl) out.push('EXPO_PUBLIC_API_URL');
  return out;
}
