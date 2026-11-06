import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui';
import { colors, space, type } from '@/lib/theme';

const PILLARS = [
  ['Create', 'Crie personagens à mão, com IA ou a partir de uma imagem.'],
  ['Connect', 'Converse, monte grupos e descubra criações da comunidade.'],
  ['Remember', 'Memória permanente: eles lembram de você semanas depois.'],
] as const;

export default function Welcome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <LinearGradient colors={['rgba(157,140,255,0.28)', 'rgba(10,10,15,0)']} style={[StyleSheet.absoluteFill, { height: 420 }]} />
      <View style={{ flex: 1, padding: space.xl, paddingTop: insets.top + space.xxl, maxWidth: 560, width: '100%', alignSelf: 'center' }}>
        <Image source={require('@/assets/images/splash-icon.png')} style={{ width: 84, height: 84 }} contentFit="contain" />
        <Text style={[type.hero, { fontSize: 48, marginTop: space.lg }]}>Vibuzz</Text>
        <Text style={[type.h2, { color: colors.accent, marginTop: space.xs }]}>Create. Connect. Remember.</Text>
        <View style={{ marginTop: space.xxl, gap: space.lg }}>
          {PILLARS.map(([t, d]) => (
            <View key={t} style={{ flexDirection: 'row', gap: space.md }}>
              <View style={{ width: 3, borderRadius: 2, backgroundColor: colors.signal }} />
              <View style={{ flex: 1 }}>
                <Text style={type.h3}>{t}</Text>
                <Text style={type.small}>{d}</Text>
              </View>
            </View>
          ))}
        </View>
        <View style={{ flex: 1 }} />
        <Button title="Criar conta" onPress={() => router.push('/sign-up')} />
        <Button title="Já tenho conta" variant="ghost" onPress={() => router.push('/sign-in')} style={{ marginTop: space.sm, marginBottom: insets.bottom }} />
      </View>
    </View>
  );
}
