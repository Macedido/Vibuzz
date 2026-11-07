import { PLAN_LIMITS } from '@vibuzz/shared';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Banner, Button, Ionicons, Row, Screen, type IconName } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { brandGradient, colors, radius, space, type } from '@/lib/theme';

const F = PLAN_LIMITS.free;
const P = PLAN_LIMITS.premium;

const ROWS: { icon: IconName; label: string; free: string; premium: string }[] = [
  { icon: 'chatbubbles-outline', label: 'Conversas e mensagens', free: 'Ilimitadas', premium: 'Ilimitadas' },
  { icon: 'people-outline', label: 'Personagens públicos', free: 'Ilimitados', premium: 'Ilimitados' },
  { icon: 'lock-closed-outline', label: 'Personagens privados', free: String(F.privateCharacters), premium: String(P.privateCharacters) },
  { icon: 'images-outline', label: 'Fotos dos personagens por dia', free: String(F.imagesPerDay), premium: String(P.imagesPerDay) },
  { icon: 'notifications-outline', label: 'Mensagens espontâneas por dia', free: `até ${F.proactivePerDay.often}`, premium: `até ${P.proactivePerDay.often}` },
  { icon: 'library-outline', label: 'Lembranças usadas por resposta', free: String(F.memoryItems), premium: String(P.memoryItems) },
  { icon: 'mic-outline', label: 'Voz e chamada por voz', free: 'Sim', premium: 'Sim' },
];

/** Plan comparison. Payments are not live yet, so Premium is a waitlist. */
export default function Premium() {
  const { userId, account, refresh } = useAuth();
  const [busy, setBusy] = useState(false);
  const isPremium = account?.plan === 'premium';
  const waiting = Boolean(account?.premium_waitlist);

  const toggleWaitlist = async () => {
    if (!userId) return;
    setBusy(true);
    await supabase.from('users').update({ premium_waitlist: !waiting }).eq('id', userId);
    await refresh();
    setBusy(false);
  };

  return (
    <Screen>
      <View style={{ maxWidth: 760, width: '100%', alignSelf: 'center' }}>
        <LinearGradient colors={[...brandGradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
          <Text style={styles.kicker}>VIBUZZ PREMIUM</Text>
          <Text style={styles.title}>Mais memória, mais fotos, mais vida própria.</Text>
          <Text style={styles.sub}>O plano grátis continua completo. O Premium é para quem passa horas nas histórias e quer que elas aguentem mais.</Text>
        </LinearGradient>

        {isPremium ? <Banner text="Você já é Premium. Obrigado por apoiar o Vibuzz!" icon="star" /> : null}

        <View style={styles.table}>
          <Row style={styles.head}>
            <Text style={[type.tiny, { flex: 1.6 }]}>Recurso</Text>
            <Text style={[type.tiny, styles.cell]}>Grátis</Text>
            <Text style={[type.tiny, styles.cell, { color: colors.signal }]}>Premium</Text>
          </Row>
          {ROWS.map((r) => (
            <Row key={r.label} style={styles.row}>
              <Row gap={10} style={{ flex: 1.6 }}>
                <Ionicons name={r.icon} size={17} color={colors.muted} />
                <Text style={[type.body, { fontSize: 14, flex: 1 }]}>{r.label}</Text>
              </Row>
              <Text style={[styles.cell, styles.val]}>{r.free}</Text>
              <Text style={[styles.cell, styles.val, { color: colors.text, fontWeight: '700' }]}>{r.premium}</Text>
            </Row>
          ))}
        </View>

        {!isPremium ? (
          <View style={styles.cta}>
            <Text style={type.h2}>{waiting ? 'Você está na lista' : 'Ainda não está à venda'}</Text>
            <Text style={[type.body, { marginTop: 4, marginBottom: space.md }]}>
              {waiting ? 'Vamos te avisar aqui no app quando o Premium abrir, com preço de lançamento.' : 'Entre na lista de espera e seja avisado quando abrir. Nada é cobrado agora.'}
            </Text>
            <Button title={waiting ? 'Sair da lista' : 'Entrar na lista de espera'} variant={waiting ? 'secondary' : 'primary'} icon={waiting ? 'close' : 'star'} onPress={toggleWaitlist} loading={busy} />
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: radius.xl, padding: space.xl, marginBottom: space.lg },
  kicker: { color: '#ffffffcc', fontSize: 11, fontWeight: '800', letterSpacing: 1.6 },
  title: { color: '#fff', fontSize: 28, fontWeight: '800', letterSpacing: -0.8, marginTop: space.sm },
  sub: { color: '#ffffffdd', fontSize: 15, lineHeight: 22, marginTop: space.sm, maxWidth: 520 },
  table: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderSoft, backgroundColor: colors.surface, overflow: 'hidden' },
  head: { paddingHorizontal: space.md, paddingVertical: space.sm, backgroundColor: colors.raised },
  row: { paddingHorizontal: space.md, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.borderSoft },
  cell: { flex: 1, textAlign: 'center' },
  val: { fontSize: 13, color: colors.textSoft },
  cta: { marginTop: space.lg, padding: space.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.accent + '55', backgroundColor: colors.accent + '10' },
});
