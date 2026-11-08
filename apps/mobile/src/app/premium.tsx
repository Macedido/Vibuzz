import { isPremiumActive, PLAN_LIMITS, type BillingInfo, type BillingPlan } from '@vibuzz/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Banner, Button, Ionicons, Row, Screen } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useQuery } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';
import { colors, fonts, radius, space, type } from '@/lib/theme';

const F = PLAN_LIMITS.free;
const P = PLAN_LIMITS.premium;
const num = (n: number) => n.toLocaleString('pt-BR');
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Only benefits the server actually enforces. */
const ROWS: { label: string; free: string; premium: string }[] = [
  { label: 'Mensagens por dia', free: num(F.messagesPerDay), premium: num(P.messagesPerDay) },
  { label: 'Resposta começa mais rápido', free: 'Normal', premium: 'Prioridade' },
  { label: 'Tamanho das respostas', free: 'Normal', premium: 'Até 2× maior' },
  { label: 'Lembranças usadas em cada resposta', free: String(F.memoryItems), premium: String(P.memoryItems) },
  { label: 'Mensagens espontâneas por dia', free: `até ${F.proactivePerDay.often}`, premium: `até ${P.proactivePerDay.often}` },
  { label: 'Personagens privados', free: String(F.privateCharacters), premium: String(P.privateCharacters) },
  { label: 'Selo Premium no perfil', free: '—', premium: 'Sim' },
];

const FAQ = [
  { q: 'É assinatura com cobrança automática?', a: 'Não. Você paga 1 mês ou 1 ano de uma vez. Quando acabar, volta para o plano grátis sem perder nada. Se pagar de novo antes, o tempo soma.' },
  { q: 'Como posso pagar?', a: 'Pix, cartão de crédito ou boleto, pelo Mercado Pago. O plano anual pode ser parcelado no cartão.' },
  { q: 'Quando o Premium começa?', a: 'Pix e cartão aprovados ativam na hora. Boleto ativa quando o banco confirmar, em até 2 dias úteis.' },
];

export default function Premium() {
  const router = useRouter();
  const params = useLocalSearchParams<{ payment_id?: string; collection_id?: string; status?: string; collection_status?: string }>();
  const { userId, account, refresh } = useAuth();
  const info = useQuery(() => api<BillingInfo>('/v1/billing', { method: 'GET' }), []);
  const [plan, setPlan] = useState<BillingPlan>('year');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'info' | 'warning' | 'danger'; text: string } | null>(null);
  const confirmed = useRef(false);

  const active = isPremiumActive(account);
  const until = account?.premium_until ? new Date(account.premium_until).toLocaleDateString('pt-BR') : null;
  const prices = info.data?.prices;

  // Back from Mercado Pago: check the payment right away instead of waiting for the webhook.
  useEffect(() => {
    const paymentId = params.payment_id ?? params.collection_id;
    if (!paymentId || paymentId === 'null' || confirmed.current) return;
    confirmed.current = true;
    const status = params.status ?? params.collection_status;
    if (status === 'rejected' || status === 'null') {
      setMessage({ tone: 'danger', text: 'O pagamento não foi aprovado. Nada foi cobrado. Tente outro meio de pagamento.' });
      return;
    }
    setMessage({ tone: 'info', text: 'Conferindo seu pagamento…' });
    api<{ status: string }>('/v1/billing/confirm', { body: { paymentId: String(paymentId) } })
      .then(async (r) => {
        await refresh();
        if (r.status === 'approved') setMessage({ tone: 'info', text: 'Pagamento aprovado. Seu Premium já está ativo!' });
        else if (r.status === 'pending') setMessage({ tone: 'warning', text: 'Pagamento em análise. O Premium ativa sozinho assim que for aprovado (boleto leva até 2 dias úteis).' });
        else setMessage({ tone: 'danger', text: 'Não encontrei um pagamento aprovado. Se você pagou, espere alguns minutos e abra esta página de novo.' });
      })
      .catch((e) => setMessage({ tone: 'danger', text: errorMessage(e) }));
  }, [params.payment_id, params.collection_id, params.status, params.collection_status, refresh]);

  const buy = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const { url } = await api<{ url: string }>('/v1/billing/checkout', { body: { plan } });
      if (Platform.OS === 'web') {
        window.location.assign(url);
        return;
      }
      await WebBrowser.openBrowserAsync(url);
      await refresh();
      setMessage({ tone: 'info', text: 'Se o pagamento foi aprovado, o Premium ativa em alguns segundos. Puxe a tela para atualizar.' });
    } catch (e) {
      setMessage({ tone: 'danger', text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const waiting = Boolean(account?.premium_waitlist);
  const toggleWaitlist = async () => {
    if (!userId) return;
    setBusy(true);
    await supabase.from('users').update({ premium_waitlist: !waiting }).eq('id', userId);
    await refresh();
    setBusy(false);
  };

  const perMonth = prices ? prices.year / 12 : 0;
  const saving = prices ? Math.round((1 - prices.year / (prices.month * 12)) * 100) : 0;

  return (
    <Screen>
      <View style={{ maxWidth: 720, width: '100%', alignSelf: 'center' }}>
        <Text style={styles.title}>Vibuzz Premium</Text>
        <Text style={[type.body, { marginTop: space.sm, maxWidth: 520 }]}>
          O plano grátis continua completo. O Premium é para quem passa horas nas histórias: mais mensagens, respostas mais rápidas e longas e mais memória.
        </Text>

        {message ? (
          <View style={{ marginTop: space.lg }}>
            <Banner tone={message.tone} text={message.text} />
          </View>
        ) : null}

        {active ? (
          <View style={styles.activeBox}>
            <Ionicons name="star" size={18} color={colors.signal} />
            <Text style={[type.body, { flex: 1, color: colors.text }]}>{until ? `Seu Premium vale até ${until}.` : 'Seu Premium está ativo.'} Pagar de novo soma mais tempo.</Text>
          </View>
        ) : null}

        {info.data?.enabled && prices ? (
          <View style={{ marginTop: space.xl }}>
            <View style={{ gap: space.sm }}>
              {(['year', 'month'] as const).map((p) => {
                const on = plan === p;
                return (
                  <Pressable key={p} onPress={() => setPlan(p)} style={[styles.plan, on && styles.planOn]} accessibilityRole="radio" accessibilityState={{ checked: on }}>
                    <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={20} color={on ? colors.accent : colors.faint} />
                    <View style={{ flex: 1 }}>
                      <Text style={type.h3}>{p === 'year' ? '12 meses' : '1 mês'}</Text>
                      <Text style={type.small}>{p === 'year' ? `${brl(perMonth)} por mês, ${saving}% mais barato` : 'Para experimentar'}</Text>
                    </View>
                    <Text style={styles.price}>{brl(prices[p])}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Button title={active ? 'Somar mais tempo' : 'Pagar com Pix ou cartão'} onPress={buy} loading={busy} style={{ marginTop: space.lg }} />
            <Text style={[type.small, { marginTop: space.sm, textAlign: 'center' }]}>Pagamento seguro pelo Mercado Pago. Sem cobrança automática.</Text>
          </View>
        ) : info.data && !active ? (
          <View style={styles.waitBox}>
            <Text style={type.h2}>{waiting ? 'Você está na lista' : 'Abre em breve'}</Text>
            <Text style={[type.body, { marginTop: 4, marginBottom: space.md }]}>
              {waiting ? 'Vamos te avisar aqui no app quando as vendas abrirem.' : 'As vendas ainda não abriram. Entre na lista e receba um aviso. Nada é cobrado.'}
            </Text>
            <Button title={waiting ? 'Sair da lista' : 'Entrar na lista de espera'} variant={waiting ? 'secondary' : 'primary'} onPress={toggleWaitlist} loading={busy} />
          </View>
        ) : null}

        <Text style={[type.h2, { marginTop: space.xxl, marginBottom: space.md }]}>O que muda</Text>
        <View style={styles.table}>
          <Row style={styles.head}>
            <Text style={[type.tiny, { flex: 1.7 }]}>Recurso</Text>
            <Text style={[type.tiny, styles.cell]}>Grátis</Text>
            <Text style={[type.tiny, styles.cell, { color: colors.signal }]}>Premium</Text>
          </Row>
          {ROWS.map((r) => (
            <Row key={r.label} style={styles.row}>
              <Text style={[type.body, { fontSize: 14, flex: 1.7 }]}>{r.label}</Text>
              <Text style={[styles.cell, styles.val]}>{r.free}</Text>
              <Text style={[styles.cell, styles.val, { color: colors.text, fontWeight: '700' }]}>{r.premium}</Text>
            </Row>
          ))}
        </View>

        <Text style={[type.h2, { marginTop: space.xxl, marginBottom: space.md }]}>Dúvidas</Text>
        <View style={{ gap: space.lg }}>
          {FAQ.map((f) => (
            <View key={f.q}>
              <Text style={type.h3}>{f.q}</Text>
              <Text style={[type.body, { marginTop: 4 }]}>{f.a}</Text>
            </View>
          ))}
        </View>
        <Button title="Voltar para as conversas" variant="ghost" onPress={() => router.replace('/')} style={{ marginTop: space.xl }} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontFamily: fonts.display, fontSize: 30, lineHeight: 36, letterSpacing: -0.6 },
  activeBox: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.lg, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.signalSoft },
  plan: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  planOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  price: { color: colors.text, fontFamily: fonts.displaySemi, fontSize: 18 },
  waitBox: { marginTop: space.xl, padding: space.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  table: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderSoft, backgroundColor: colors.surface, overflow: 'hidden' },
  head: { paddingHorizontal: space.md, paddingVertical: space.sm, backgroundColor: colors.raised },
  row: { paddingHorizontal: space.md, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.borderSoft },
  cell: { flex: 1, textAlign: 'center' },
  val: { fontSize: 13, color: colors.textSoft },
});
