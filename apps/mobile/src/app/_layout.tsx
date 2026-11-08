import { DarkTheme, Stack, ThemeProvider, useRouter, useSegments } from 'expo-router';
import * as Linking from 'expo-linking';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { Unbounded_600SemiBold, Unbounded_800ExtraBold, useFonts } from '@expo-google-fonts/unbounded';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Banner, HeaderBack } from '@/components/ui';
import { AuthProvider, useAuth } from '@/lib/auth';
import { checkNotifications, onNotificationTap } from '@/lib/native-notify';
import { setupPwa } from '@/lib/pwa';
import { missingConfig } from '@/lib/config';
import { supabase } from '@/lib/supabase';
import { colors, space, type } from '@/lib/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.bg, text: colors.text, border: colors.borderSoft, primary: colors.accent },
};

/** Handles auth links (password recovery / email confirmation) on native. */
function useAuthLinks() {
  const router = useRouter();
  useEffect(() => {
    const handle = async (url: string | null) => {
      if (!url) return;
      const fragment = url.split('#')[1] ?? url.split('?')[1] ?? '';
      const params = new URLSearchParams(fragment);
      const access_token = params.get('access_token');
      const refresh_token = params.get('refresh_token');
      if (access_token && refresh_token) {
        await supabase.auth.setSession({ access_token, refresh_token });
        if (params.get('type') === 'recovery') router.push('/reset-password');
      }
    };
    Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener('url', (e) => void handle(e.url));
    return () => sub.remove();
  }, [router]);
}

function Gate() {
  const { ready, session, account } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  useAuthLinks();

  useEffect(() => {
    if (!ready) return;
    SplashScreen.hideAsync().catch(() => {});
    const inAuth = segments[0] === '(auth)';
    const publicRoutes = ['legal', 'reset-password'];
    if (!session && !inAuth && !publicRoutes.includes(segments[0] ?? '')) router.replace('/welcome');
    else if (session && account && !account.birthdate && segments[0] !== 'complete-signup') router.replace('/complete-signup');
    else if (session && inAuth) router.replace('/');
  }, [ready, session, account, segments, router]);

  useEffect(() => setupPwa(), []);
  useEffect(() => onNotificationTap((url) => router.push(url as never)), [router]);
  useEffect(() => {
    // App opened: show what arrived while it was closed (native only; no-op on web).
    if (session) void checkNotifications().catch(() => {});
  }, [session]);

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '700' },
        headerShadowVisible: false,
        headerTransparent: false,
        headerBackButtonDisplayMode: 'minimal',
        headerLeft: () => <HeaderBack />,
        contentStyle: { backgroundColor: colors.bg },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="character/[id]" options={{ title: '' }} />
      <Stack.Screen name="chat/[id]" options={{ title: '' }} />
      <Stack.Screen name="memories/[id]" options={{ title: 'Memórias' }} />
      <Stack.Screen name="gallery/[id]" options={{ title: 'Galeria' }} />
      <Stack.Screen name="relationship/[id]" options={{ title: 'Relação' }} />
      <Stack.Screen name="collection/[id]" options={{ title: 'Coleção' }} />
      <Stack.Screen name="achievements" options={{ title: 'Conquistas' }} />
      <Stack.Screen name="premium" options={{ title: 'Vibuzz Premium' }} />
      <Stack.Screen name="complete-signup" options={{ title: 'Quase lá', headerBackVisible: false }} />
      <Stack.Screen name="create/import" options={{ title: 'Importar personagem' }} />
      <Stack.Screen name="create/editor" options={{ title: 'Personagem' }} />
      <Stack.Screen name="create/ai" options={{ title: 'Criar com IA' }} />
      <Stack.Screen name="personas/index" options={{ title: 'Personas' }} />
      <Stack.Screen name="personas/edit" options={{ title: 'Persona' }} />
      <Stack.Screen name="user/[id]" options={{ title: '' }} />
      <Stack.Screen name="settings" options={{ title: 'Configurações' }} />
      <Stack.Screen name="edit-profile" options={{ title: 'Editar perfil' }} />
      <Stack.Screen name="notifications" options={{ title: 'Notificações' }} />
      <Stack.Screen name="report" options={{ title: 'Denunciar', presentation: 'modal' }} />
      <Stack.Screen name="legal" options={{ title: 'Termos e privacidade' }} />
      <Stack.Screen name="reset-password" options={{ title: 'Nova senha' }} />
    </Stack>
  );
}

function MissingConfig({ missing }: { missing: string[] }) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, padding: space.xl, justifyContent: 'center' }}>
      <Text style={type.hero}>Vibuzz</Text>
      <Text style={[type.body, { marginVertical: space.lg }]}>O app ainda não está configurado. Crie o arquivo apps/mobile/.env (veja .env.example) com:</Text>
      {missing.map((m) => (
        <Banner key={m} tone="warning" text={m} icon="key-outline" />
      ))}
      <Text style={type.small}>Guia completo em docs/SETUP.md.</Text>
    </View>
  );
}

export default function RootLayout() {
  const missing = missingConfig();
  // Titles use Unbounded; wait for it (max ~2 s on slow networks, then fall back) so nothing jumps.
  const [fontsLoaded, fontError] = useFonts({ Unbounded_600SemiBold, Unbounded_800ExtraBold });
  const [fontTimeout, setFontTimeout] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setFontTimeout(true), 2000);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (missing.length) SplashScreen.hideAsync().catch(() => {});
  }, [missing.length]);

  if (!fontsLoaded && !fontError && !fontTimeout) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <ThemeProvider value={theme}>
          <StatusBar style="light" />
          {missing.length ? (
            <MissingConfig missing={missing} />
          ) : (
            <AuthProvider>
              <Gate />
            </AuthProvider>
          )}
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
