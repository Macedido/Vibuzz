import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PortraitCard } from '@/components/character-card';
import { GoogleButton } from '@/components/google-button';
import { Ionicons } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { colors, fonts, radius, space } from '@/lib/theme';
import type { CharacterCard } from '@/lib/types';

const LOGO = require('@/assets/images/logo-mark.png');

/** What "vida própria" looks like from the outside: messages waiting on the lock screen. */
const NOTIFICATIONS = [
  { from: 'Lyra', when: 'agora', text: 'Lembrei do farol que você me contou ontem. Ainda não acredito que você entrou lá sozinho.' },
  { from: 'Kael Voss', when: '12 min', text: 'Olha o que achei no terminal da torre. Isso é seu?', photo: true },
  { from: 'Os Quatro', when: '1 h', text: 'Marina: alguém avisa que a janta de hoje é por conta dela?' },
];

const POINTS = [
  { title: 'Lembram de ontem', text: 'Promessas, segredos e apelidos ficam guardados. Se a história se divide, cada versão lembra só do que aconteceu nela.' },
  { title: 'Puxam assunto', text: 'Ligue a vida própria numa conversa e o personagem manda mensagem ou foto entre 8h e 22h. Você escolhe com que frequência.' },
  { title: 'Falam com você', text: 'Cada personagem tem a própria voz. Ouça as respostas ou ligue e converse falando, sem digitar.' },
  { title: 'Você cria', text: 'Descreva uma ideia ou importe uma ficha de outro app. A IA organiza tudo e desenha o retrato.' },
];

function Notification({ n, depth }: { n: (typeof NOTIFICATIONS)[number]; depth: number }) {
  return (
    <View style={[styles.note, { opacity: 1 - depth * 0.18, transform: [{ scale: 1 - depth * 0.035 }] }]}>
      <View style={styles.noteHead}>
        <Image source={LOGO} style={{ width: 18, height: 18 }} contentFit="contain" />
        <Text style={styles.noteApp}>Vibuzz</Text>
        <Text style={styles.noteWhen}>{n.when}</Text>
      </View>
      <Text style={styles.noteFrom}>{n.from}</Text>
      <Text style={styles.noteText} numberOfLines={2}>
        {n.photo ? (
          <>
            <Ionicons name="image" size={13} color={colors.textSoft} />{' '}
          </>
        ) : null}
        {n.text}
      </Text>
    </View>
  );
}

function Bubble({ who, children, mine }: { who?: string; children: React.ReactNode; mine?: boolean }) {
  return (
    <View style={{ alignItems: mine ? 'flex-end' : 'flex-start', marginBottom: 10 }}>
      {who ? <Text style={styles.who}>{who}</Text> : null}
      <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>{children}</View>
    </View>
  );
}

/** A real conversation as it looks in the app: memory, a photo, an emotion and a relationship meter. */
function ChatPreview() {
  return (
    <View style={styles.phone}>
      <View style={styles.phoneHead}>
        <View style={styles.phoneAvatar}>
          <Text style={{ color: '#fff', fontFamily: fonts.display, fontSize: 15 }}>L</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>Lyra</Text>
          <Text style={{ color: colors.muted, fontSize: 12 }}>Biblioteca de Vael</Text>
        </View>
        <Ionicons name="call-outline" size={18} color={colors.textSoft} />
      </View>
      <View style={{ padding: 14 }}>
        <Bubble who="Lyra">
          <Text style={styles.txt}>
            <Text style={styles.act}>Encosta no balcão. </Text>
            Lembrei do farol que você me contou ontem. Ainda não acredito que você entrou lá sozinho.
          </Text>
        </Bubble>
        <Text style={styles.caption}>feliz · mandou sozinha</Text>
        <Bubble>
          <View style={styles.photo}>
            <View style={styles.sky} />
            <View style={styles.sea} />
            <View style={styles.sun} />
            <View style={styles.lighthouse} />
          </View>
          <Text style={[styles.txt, { marginTop: 6 }]}>Achei esse pôr do sol lá. Parece o seu farol?</Text>
        </Bubble>
        <Bubble mine>
          <Text style={[styles.txt, { color: '#fff' }]}>Você guardou meu segredo?</Text>
        </Bubble>
        <Bubble who="Lyra">
          <Text style={styles.txt}>
            Óbvio. <Text style={styles.act}>Pisca.</Text> Nem o Kael sabe.
          </Text>
        </Bubble>
        <View style={styles.meter}>
          <Text style={{ color: colors.textSoft, fontSize: 12, width: 74 }}>Confiança</Text>
          <View style={styles.meterTrack}>
            <View style={[styles.meterFill, { width: '78%' }]} />
          </View>
          <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>78</Text>
        </View>
      </View>
    </View>
  );
}

/** Community characters (shown once there are enough public ones with art). */
function useTrending(): CharacterCard[] {
  const [rows, setRows] = useState<CharacterCard[]>([]);
  useEffect(() => {
    supabase
      .rpc('discover_characters', { p_sort: 'trending', p_limit: 12 })
      .then(({ data }) => setRows(((data as CharacterCard[] | null) ?? []).filter((c) => c.avatar_path)))
      .then(undefined, () => {});
  }, []);
  return rows;
}

export default function Welcome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = width >= 920;
  const trending = useTrending();
  const cols = width >= 1100 ? 6 : width >= 760 ? 4 : 2;
  const cardW = Math.floor((Math.min(width, 1120) - space.xl * 2 - space.md * (cols - 1)) / cols);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + space.md, paddingBottom: insets.bottom + space.xl }}>
        <View style={styles.wrap}>
          <View style={styles.nav}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Image source={LOGO} style={{ width: 36, height: 36 }} contentFit="contain" accessibilityLabel="" />
              <Text style={styles.brand}>Vibuzz</Text>
            </View>
            <Pressable onPress={() => router.push('/sign-in')} hitSlop={10} style={styles.navLink}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>Entrar</Text>
            </Pressable>
          </View>

          <View style={[styles.hero, wide && { flexDirection: 'row', alignItems: 'center', gap: 64 }]}>
            <View style={{ flex: wide ? 1.1 : undefined }}>
              <Text style={[styles.h1, !wide && { fontSize: 36, lineHeight: 42 }]}>Tem alguém esperando sua mensagem.</Text>
              <Text style={styles.lead}>
                No Vibuzz você conversa com personagens criados pela comunidade, ou cria o seu. Eles lembram do que vocês viveram e, se você deixar, puxam assunto sozinhos.
              </Text>
              <View style={{ gap: space.sm, marginTop: space.xl, maxWidth: 400 }}>
                <Pressable onPress={() => router.push('/sign-up')} style={({ pressed }) => [styles.cta, pressed && { opacity: 0.88 }]}>
                  <Text style={styles.ctaText}>Criar conta grátis</Text>
                </Pressable>
                <GoogleButton />
                <Pressable onPress={() => router.push('/sign-in')} style={styles.ghost}>
                  <Text style={{ color: colors.textSoft, fontWeight: '700' }}>Já tenho conta</Text>
                </Pressable>
              </View>
            </View>
            <View style={[styles.stack, !wide && { marginTop: space.xxl }]}>
              {NOTIFICATIONS.map((n, i) => (
                <Notification key={n.from} n={n} depth={i} />
              ))}
            </View>
          </View>

          <View style={[styles.inside, wide && { flexDirection: 'row', alignItems: 'flex-start', gap: 64 }]}>
            <View style={{ alignItems: 'center', flex: wide ? 1 : undefined }}>
              <ChatPreview />
            </View>
            <View style={{ flex: wide ? 1.1 : undefined, marginTop: wide ? space.lg : space.xxl, gap: space.xl }}>
              <Text style={styles.h2}>Como é por dentro</Text>
              {POINTS.map((p) => (
                <View key={p.title} style={{ maxWidth: 520 }}>
                  <Text style={styles.pointTitle}>{p.title}</Text>
                  <Text style={styles.pointText}>{p.text}</Text>
                </View>
              ))}
            </View>
          </View>

          {trending.length >= 4 ? (
            <View style={{ marginTop: space.xxl * 2 }}>
              <Text style={[styles.h2, { marginBottom: space.lg }]}>Em alta agora</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
                {trending.slice(0, cols * 2).map((c) => (
                  <PortraitCard key={c.id} c={c} width={cardW} />
                ))}
              </View>
            </View>
          ) : null}

          <View style={styles.footer}>
            <Text style={{ color: colors.faint, fontSize: 12 }}>© 2026 Vibuzz. Feito no Brasil.</Text>
            <View style={{ flexDirection: 'row', gap: space.lg }}>
              <Pressable onPress={() => router.push('/legal')}>
                <Text style={styles.footLink}>Termos e privacidade</Text>
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
  brand: { color: colors.text, fontSize: 19, fontFamily: fonts.display, letterSpacing: -0.4 },
  navLink: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  hero: { paddingTop: space.xxl * 1.5, paddingBottom: space.xxl },
  h1: { color: colors.text, fontSize: 54, lineHeight: 60, fontFamily: fonts.display, letterSpacing: -1.4, maxWidth: 620 },
  h2: { color: colors.text, fontSize: 22, lineHeight: 28, fontFamily: fonts.displaySemi, letterSpacing: -0.3 },
  lead: { color: colors.textSoft, fontSize: 17, lineHeight: 27, marginTop: space.lg, maxWidth: 540 },
  cta: { height: 54, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
  ctaText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  ghost: { height: 46, alignItems: 'center', justifyContent: 'center' },
  stack: { flex: 1, maxWidth: 420, width: '100%', alignSelf: 'center', gap: 10 },
  note: { borderRadius: 20, padding: 14, backgroundColor: 'rgba(26,33,72,0.72)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  noteHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  noteApp: { flex: 1, color: colors.muted, fontSize: 12, fontWeight: '600' },
  noteWhen: { color: colors.faint, fontSize: 12 },
  noteFrom: { color: colors.text, fontSize: 15, fontWeight: '700' },
  noteText: { color: colors.textSoft, fontSize: 14, lineHeight: 20, marginTop: 2 },
  inside: { marginTop: space.xxl * 2 },
  pointTitle: { color: colors.text, fontSize: 17, fontFamily: fonts.displaySemi, marginBottom: 6 },
  pointText: { color: colors.muted, fontSize: 15, lineHeight: 23 },
  phone: { width: '100%', maxWidth: 380, borderRadius: 28, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  phoneHead: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  phoneAvatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: '#4A1733' },
  who: { color: colors.signal, fontSize: 12, fontWeight: '700', marginBottom: 3, marginLeft: 4 },
  bubble: { maxWidth: '88%', borderRadius: 18, paddingHorizontal: 12, paddingVertical: 9 },
  theirs: { backgroundColor: colors.raised, borderTopLeftRadius: 6 },
  mine: { backgroundColor: colors.userBubble, borderTopRightRadius: 6 },
  txt: { color: colors.text, fontSize: 14, lineHeight: 20 },
  act: { color: colors.muted, fontStyle: 'italic' },
  caption: { color: colors.faint, fontSize: 11, marginTop: -6, marginBottom: 10, marginLeft: 6 },
  photo: { width: 220, height: 140, borderRadius: 12, overflow: 'hidden', backgroundColor: '#D9805B' },
  sky: { position: 'absolute', left: 0, right: 0, top: 0, height: 70, backgroundColor: '#F2A65A' },
  sea: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 52, backgroundColor: '#2A2E7A' },
  sun: { position: 'absolute', width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFE1AE', left: 128, top: 52 },
  lighthouse: { position: 'absolute', width: 12, height: 70, backgroundColor: '#101436', left: 52, bottom: 30, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  meter: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, padding: 10, borderRadius: 12, backgroundColor: colors.bg },
  meterTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.overlay, overflow: 'hidden' },
  meterFill: { height: 6, borderRadius: 3, backgroundColor: colors.accent },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: space.md, marginTop: space.xxl * 2, paddingTop: space.lg, borderTopWidth: 1, borderTopColor: colors.borderSoft },
  footLink: { color: colors.muted, fontSize: 13 },
});
