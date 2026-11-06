import { MIN_AGE } from '@vibuzz/shared';
import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { useState } from 'react';
import { Pressable, Text } from 'react-native';
import { Banner, Button, Field, Ionicons, Row, Screen } from '@/components/ui';
import { ageOf } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { colors, space, type } from '@/lib/theme';

/** "DD/MM/AAAA" → "AAAA-MM-DD" (validated) or null. */
export function parseBirthdate(input: string): string | null {
  const m = input.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const iso = `${y}-${mo}-${d}`;
  const date = new Date(iso + 'T00:00:00');
  if (Number.isNaN(date.getTime()) || date.getDate() !== Number(d) || date.getMonth() + 1 !== Number(mo)) return null;
  if (date > new Date() || Number(y) < 1900) return null;
  return iso;
}

function maskDate(v: string) {
  const digits = v.replace(/\D/g, '').slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join('/');
}

export default function SignUp() {
  const router = useRouter();
  const [form, setForm] = useState({ displayName: '', username: '', email: '', password: '', birth: '' });
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: k === 'birth' ? maskDate(v) : k === 'username' ? v.toLowerCase().replace(/[^a-z0-9_.]/g, '') : v }));

  const submit = async () => {
    setError(null);
    const birthdate = parseBirthdate(form.birth);
    if (!birthdate) return setError('Data de nascimento inválida (use DD/MM/AAAA).');
    if (ageOf(birthdate) < MIN_AGE) return setError(`O Vibuzz é para pessoas com ${MIN_AGE} anos ou mais.`);
    if (!/^[a-z0-9_.]{3,24}$/.test(form.username)) return setError('Nome de usuário: 3–24 letras minúsculas, números, _ ou .');
    if (form.password.length < 8) return setError('A senha precisa ter pelo menos 8 caracteres.');
    if (!accepted) return setError('Aceite os termos para continuar.');
    setLoading(true);
    const { data: available } = await supabase.rpc('is_username_available', { p_username: form.username });
    if (available === false) {
      setLoading(false);
      return setError('Esse nome de usuário já está em uso.');
    }
    const { data, error } = await supabase.auth.signUp({
      email: form.email.trim(),
      password: form.password,
      options: {
        emailRedirectTo: Linking.createURL('/'),
        data: { birthdate, username: form.username, display_name: form.displayName.trim() || form.username },
      },
    });
    setLoading(false);
    if (error) return setError(/registered|exists/i.test(error.message) ? 'Esse e-mail já tem conta.' : 'Não foi possível criar a conta. Verifique os dados.');
    if (data.session) router.replace('/');
    else setDone(true);
  };

  if (done) {
    return (
      <Screen style={{ maxWidth: 520, width: '100%', alignSelf: 'center' }}>
        <Text style={type.h1}>Confirme seu e-mail</Text>
        <Text style={[type.body, { marginVertical: space.lg }]}>Enviamos um link para {form.email}. Depois de confirmar, volte e entre.</Text>
        <Button title="Ir para o login" onPress={() => router.replace('/sign-in')} />
      </Screen>
    );
  }

  return (
    <Screen keyboard style={{ maxWidth: 520, width: '100%', alignSelf: 'center' }}>
      <Text style={[type.h1, { marginBottom: space.xl }]}>Criar conta</Text>
      {error ? <Banner tone="danger" text={error} /> : null}
      <Field label="Nome" value={form.displayName} onChangeText={set('displayName')} maxLength={50} />
      <Field label="Nome de usuário" value={form.username} onChangeText={set('username')} autoCapitalize="none" maxLength={24} placeholder="seu_nome" />
      <Field label="E-mail" value={form.email} onChangeText={set('email')} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
      <Field label="Senha" value={form.password} onChangeText={set('password')} secureTextEntry hint="mín. 8 caracteres" autoComplete="new-password" />
      <Field label="Data de nascimento" value={form.birth} onChangeText={set('birth')} keyboardType="number-pad" placeholder="DD/MM/AAAA" hint="não aparece no perfil" />
      <Pressable onPress={() => setAccepted((a) => !a)}>
        <Row style={{ marginVertical: space.md }} gap={space.sm}>
          <Ionicons name={accepted ? 'checkbox' : 'square-outline'} size={22} color={accepted ? colors.accent : colors.muted} />
          <Text style={[type.small, { flex: 1 }]}>
            Li e aceito os{' '}
            <Text style={{ color: colors.accent }} onPress={() => router.push('/legal')}>
              Termos de Uso e a Política de Privacidade
            </Text>
            .
          </Text>
        </Row>
      </Pressable>
      <Button title="Criar conta" onPress={submit} loading={loading} disabled={!form.email || !form.password || !form.username || !form.birth} />
    </Screen>
  );
}
