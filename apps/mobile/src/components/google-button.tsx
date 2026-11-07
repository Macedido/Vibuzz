import * as Linking from 'expo-linking';
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { config } from '@/lib/config';
import { supabase } from '@/lib/supabase';
import { colors, radius, space } from '@/lib/theme';

let cached: boolean | null = null;

/** True when the project has the Google provider turned on (public auth settings). */
export function useGoogleEnabled(): boolean {
  const [on, setOn] = useState(Boolean(cached));
  useEffect(() => {
    if (cached !== null) return;
    fetch(`${config.supabaseUrl}/auth/v1/settings`, { headers: { apikey: config.supabaseAnonKey } })
      .then((r) => r.json())
      .then((s: { external?: { google?: boolean } }) => {
        cached = Boolean(s.external?.google);
        setOn(cached);
      })
      .catch(() => {});
  }, []);
  return on;
}

function GoogleMark() {
  return (
    <View style={styles.mark}>
      <Text style={{ fontWeight: '900', fontSize: 15, color: '#4285F4' }}>G</Text>
    </View>
  );
}

/** "Continuar com Google" — shown only when Google sign-in is configured. */
export function GoogleButton({ onError, divider }: { onError?: (msg: string) => void; divider?: string }) {
  const enabled = useGoogleEnabled();
  const [busy, setBusy] = useState(false);
  if (!enabled) return null;
  const go = async () => {
    setBusy(true);
    const redirectTo = Platform.OS === 'web' ? window.location.origin + window.location.pathname.replace(/\/(welcome|sign-in|sign-up)\/?$/, '/') : Linking.createURL('/');
    const { data, error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, skipBrowserRedirect: Platform.OS !== 'web' } });
    if (error) {
      setBusy(false);
      onError?.('Não deu para entrar com Google agora.');
      return;
    }
    if (Platform.OS !== 'web' && data?.url) await Linking.openURL(data.url);
    setBusy(false);
  };
  return (
    <View>
      <Pressable onPress={go} disabled={busy} style={({ pressed }) => [styles.btn, (pressed || busy) && { opacity: 0.8 }]} accessibilityRole="button">
        <GoogleMark />
        <Text style={styles.label}>{busy ? 'Abrindo o Google…' : 'Continuar com Google'}</Text>
      </Pressable>
      {divider ? <Text style={styles.divider}>{divider}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  btn: { height: 50, borderRadius: radius.pill, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm },
  label: { color: '#111522', fontWeight: '700', fontSize: 15 },
  divider: { color: colors.muted, fontSize: 13, textAlign: 'center', marginVertical: space.md },
  mark: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: '#E3E6EF' },
});
