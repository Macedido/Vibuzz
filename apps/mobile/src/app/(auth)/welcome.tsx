import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GoogleButton } from '@/components/google-button';
import { Ionicons } from '@/components/ui';
import { brandGradient, colors, radius, space } from '@/lib/theme';

const FEATURES = [
  { icon: 'bulb', title: 'Memória que dura', text: 'Promessas, segredos e detalhes ficam guardados. Cada ramificação da história lembra só do que aconteceu nela.' },
  { icon: 'sparkles', title: 'Vida própria', text: 'Se você deixar, eles mandam mensagem e foto contando o que aconteceu enquanto você estava fora.' },
  { icon: 'mic', title: 'Voz e chamada', text: 'Ouça as respostas com a voz de cada personagem ou fale com ele como numa ligação.' },
  { icon: 'color-wand', title: 'Crie em minutos', text: 'Descreva uma ideia ou importe uma ficha (.json ou .png). A IA monta o resto e desenha o retrato.' },
  { icon: 'trophy', title: 'Comunidade', text: 'Ranking da semana, coleções, conquistas e perfis de criador para seguir quem você curte.' },
  { icon: 'people', title: 'Grupos e histórias', text: 'Junte até 8 personagens numa cena ou crie uma história em que você é o protagonista.' },
] as const;

function Bubble({ who, children, mine }: { who?: string; children: React.ReactNode; mine?: boolean }) {
  return (
    <View style={{ alignItems: mine ? 'flex-end' : 'flex-start', marginBottom: 10 }}>
      {who ? <Text style={styles.who}>{who}</Text> : null}
      <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>{children}</View>
    </View>
  );
}

/** A static preview of a real chat: spontaneous message, photo, emotion and a relationship meter. */
function ChatPreview() {
  return (
    <View style={styles.phone}>
      <View style={styles.phoneHead}>
        <LinearGradient colors={['#5A2443', '#25356B']} style={styles.phoneAvatar}>
          <Text style={{ color: '#fff', fontWeight: '900' }}>L</Text>
        </LinearGradient>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontWeight: '800' }}>Lyra</Text>
          <Text style={{ color: colors.signal, fontSize: 11 }}>mandou uma mensagem · 09:14</Text>
        </View>
        <Ionicons name="call" size={18} color={colors.textSoft} />
      </View>
      <View style={{ padding: 14 }}>
        <Bubble who="Lyra">
          <Text style={styles.txt}>
            <Text style={styles.act}>encosta no balcão da biblioteca. </Text>
            Lembrei do farol que você me contou ontem. Ainda não acredito que você entrou lá sozinho.
          </Text>
        </Bubble>
        <View style={{ flexDirection: 'row', gap: 6, marginTop: -4, marginBottom: 10 }}>
          <Text style={styles.chip}>😊 feliz</Text>
          <Text style={[styles.chip, { color: colors.signal }]}>✦ mandou do nada</Text>
        </View>
        <Bubble>
          <LinearGradient colors={['#F6A35B', '#B4477B', '#2A2E7A']} locations={[0, 0.55, 1]} style={styles.photo}>
            <View style={styles.sun} />
            <View style={styles.lighthouse} />
          </LinearGradient>
          <Text style={[styles.txt, { marginTop: 6 }]}>Achei esse pôr do sol lá. Parece o seu farol?</Text>
        </Bubble>
        <Bubble mine>
          <Text style={[styles.txt, { color: '#fff' }]}>Você guardou meu segredo?</Text>
        </Bubble>
        <Bubble who="Lyra">
          <Text style={styles.txt}>
            Óbvio. <Text style={styles.act}>pisca.</Text> Nem o Kael sabe.
          </Text>
        </Bubble>
        <View style={styles.meter}>
          <Text style={{ color: colors.textSoft, fontSize: 12, width: 74 }}>Confiança</Text>
          <View style={styles.meterTrack}>
            <LinearGradient colors={[...brandGradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.meterFill, { width: '78%' }]} />
          </View>
          <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>78</Text>
        </View>
      </View>
    </View>
  );
}

export default function Welcome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = width >= 920;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <LinearGradient colors={['rgba(42,125,255,0.22)', 'rgba(3,4,26,0)']} start={{ x: 1, y: 0 }} end={{ x: 0.2, y: 0.7 }} style={[StyleSheet.absoluteFill, { height: 720 }]} />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + space.md, paddingBottom: insets.bottom + space.xl }}>
        <View style={styles.wrap}>
          <View style={styles.nav}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Image source={require('@/assets/images/logo-mark.png')} style={{ width: 38, height: 38 }} contentFit="contain" />
              <Text style={styles.brand}>Vibuzz</Text>
            </View>
            <Pressable onPress={() => router.push('/sign-in')} hitSlop={10} style={styles.navLink}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>Entrar</Text>
            </Pressable>
          </View>

          <View style={[styles.hero, wide && { flexDirection: 'row', alignItems: 'center', gap: 56 }]}>
            <View style={{ flex: wide ? 1.05 : undefined }}>
              <Text style={styles.kicker}>PERSONAGENS COM IA · GRÁTIS</Text>
              <Text style={[styles.h1, !wide && { fontSize: 44, lineHeight: 48 }]}>Eles lembram{'\n'}de você.</Text>
              <Text style={styles.lead}>
                Converse com personagens da comunidade, crie os seus e deixe que eles mandem mensagem, foto e falem com você — só quando você quiser.
              </Text>
              <View style={{ gap: space.sm, marginTop: space.xl, maxWidth: 420 }}>
                <Pressable onPress={() => router.push('/sign-up')} style={({ pressed }) => [pressed && { opacity: 0.9 }]}>
                  <LinearGradient colors={[...brandGradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.cta}>
                    <Text style={styles.ctaText}>Criar conta grátis</Text>
                    <Ionicons name="arrow-forward" size={18} color="#fff" />
                  </LinearGradient>
                </Pressable>
                <GoogleButton />
                <Pressable onPress={() => router.push('/sign-in')} style={styles.ghost}>
                  <Text style={{ color: colors.textSoft, fontWeight: '700' }}>Já tenho conta</Text>
                </Pressable>
              </View>
            </View>
            <View style={{ flex: wide ? 1 : undefined, marginTop: wide ? 0 : space.xxl, alignItems: 'center' }}>
              <ChatPreview />
            </View>
          </View>

          <View style={[styles.grid, wide && { flexDirection: 'row', flexWrap: 'wrap' }]}>
            {FEATURES.map((f) => (
              <View key={f.title} style={[styles.feature, wide && { width: '31.5%' }]}>
                <View style={styles.featureIcon}>
                  <Ionicons name={f.icon} size={18} color={colors.signal} />
                </View>
                <Text style={styles.featureTitle}>{f.title}</Text>
                <Text style={styles.featureText}>{f.text}</Text>
              </View>
            ))}
          </View>

          <View style={styles.footer}>
            <Text style={{ color: colors.faint, fontSize: 12 }}>© 2026 Vibuzz</Text>
            <View style={{ flexDirection: 'row', gap: space.lg }}>
              <Pressable onPress={() => router.push('/legal')}>
                <Text style={styles.footLink}>Termos</Text>
              </Pressable>
              <Pressable onPress={() => router.push('/legal')}>
                <Text style={styles.footLink}>Privacidade</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', maxWidth: 1120, alignSelf: 'center', paddingHorizontal: space.xl },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: space.sm },
  brand: { color: colors.text, fontSize: 22, fontWeight: '900', letterSpacing: -0.6 },
  navLink: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  hero: { paddingTop: space.xxl, paddingBottom: space.xl },
  kicker: { color: colors.signal, fontSize: 12, fontWeight: '800', letterSpacing: 1.6, marginBottom: space.md },
  h1: { color: colors.text, fontSize: 64, lineHeight: 66, fontWeight: '900', letterSpacing: -2.4 },
  lead: { color: colors.textSoft, fontSize: 17, lineHeight: 26, marginTop: space.lg, maxWidth: 520 },
  cta: { height: 54, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  ctaText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  ghost: { height: 46, alignItems: 'center', justifyContent: 'center' },
  phone: { width: '100%', maxWidth: 380, borderRadius: 28, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  phoneHead: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  phoneAvatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  who: { color: colors.signal, fontSize: 11, fontWeight: '800', marginBottom: 3, marginLeft: 4 },
  bubble: { maxWidth: '88%', borderRadius: 18, paddingHorizontal: 12, paddingVertical: 9 },
  theirs: { backgroundColor: colors.raised, borderTopLeftRadius: 6 },
  mine: { backgroundColor: colors.userBubble, borderTopRightRadius: 6 },
  txt: { color: colors.text, fontSize: 14, lineHeight: 20 },
  act: { color: colors.muted, fontStyle: 'italic' },
  chip: { color: colors.textSoft, fontSize: 11, backgroundColor: colors.raised, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, overflow: 'hidden' },
  photo: { width: 220, height: 140, borderRadius: 12, overflow: 'hidden' },
  sun: { position: 'absolute', width: 46, height: 46, borderRadius: 23, backgroundColor: '#FFD9A0', left: 120, top: 46, opacity: 0.9 },
  lighthouse: { position: 'absolute', width: 12, height: 64, backgroundColor: '#101436', left: 52, bottom: 0, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  meter: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, padding: 10, borderRadius: 12, backgroundColor: colors.bg },
  meterTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.overlay, overflow: 'hidden' },
  meterFill: { height: 6, borderRadius: 3 },
  grid: { gap: space.lg, marginTop: space.xl, justifyContent: 'space-between' },
  feature: { padding: space.lg, borderRadius: radius.xl, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSoft },
  featureIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.signalSoft, alignItems: 'center', justifyContent: 'center', marginBottom: space.md },
  featureTitle: { color: colors.text, fontSize: 17, fontWeight: '800', marginBottom: 4 },
  featureText: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space.xxl, paddingTop: space.lg, borderTopWidth: 1, borderTopColor: colors.borderSoft },
  footLink: { color: colors.muted, fontSize: 13 },
});
