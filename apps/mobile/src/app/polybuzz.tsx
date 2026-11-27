import { Stack } from 'expo-router';
import { useEffect, useRef, useState, type ComponentType } from 'react';
import { ActivityIndicator, BackHandler, Platform, View } from 'react-native';
import { WebView as RNWebView } from 'react-native-webview';
import { colors } from '@/lib/theme';

// The library's class typings don't match this React version; the component works the same.
const WebView = RNWebView as unknown as ComponentType<Record<string, unknown>>;

const URL = 'https://www.polybuzz.ai/';

/** PolyBuzz opened inside the app (personal shortcut). Login stays saved in the WebView. */
export default function PolyBuzz() {
  const ref = useRef<{ goBack: () => void } | null>(null);
  const [canGoBack, setCanGoBack] = useState(false);

  // Android back button goes back inside the site first.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!canGoBack) return false;
      ref.current?.goBack();
      return true;
    });
    return () => sub.remove();
  }, [canGoBack]);

  if (Platform.OS === 'web') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Stack.Screen options={{ title: 'PolyBuzz' }} />
        {/* eslint-disable-next-line react/no-unknown-property */}
        <iframe src={URL} style={{ flex: 1, border: 0, width: '100%', height: '100%' }} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: 'PolyBuzz' }} />
      <WebView
        ref={ref}
        source={{ uri: URL }}
        style={{ flex: 1, backgroundColor: colors.bg }}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        domStorageEnabled
        javaScriptEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        setSupportMultipleWindows={false}
        onNavigationStateChange={(s: { canGoBack: boolean }) => setCanGoBack(s.canGoBack)}
        startInLoadingState
        renderLoading={() => (
          <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
            <ActivityIndicator color={colors.accent} />
          </View>
        )}
      />
    </View>
  );
}
