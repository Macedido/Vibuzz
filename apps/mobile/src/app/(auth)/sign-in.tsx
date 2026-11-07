import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { useState } from 'react';
import { Text } from 'react-native';
import { GoogleButton } from '@/components/google-button';
import { Banner, Button, Field, Screen } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { space, type } from '@/lib/theme';

export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) {
      setError(/confirm/i.test(error.message) ? 'Confirme seu e-mail antes de entrar.' : 'E-mail ou senha incorretos.');
      return;
    }
    router.replace('/');
  };

  const forgot = async () => {
    if (!email.trim()) {
      setError('Digite seu e-mail acima para receber o link.');
      return;
    }
    setError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: Linking.createURL('/reset-password') });
    if (error) setError('Não foi possível enviar o e-mail agora.');
    else setInfo('Enviamos um link para redefinir sua senha.');
  };

  return (
    <Screen keyboard style={{ maxWidth: 520, width: '100%', alignSelf: 'center' }}>
      <Text style={[type.h1, { marginBottom: space.xl }]}>Bem-vindo de volta</Text>
      {error ? <Banner tone="danger" text={error} /> : null}
      {info ? <Banner text={info} /> : null}
      <GoogleButton onError={setError} divider="ou entre com e-mail" />
      <Field label="E-mail" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
      <Field label="Senha" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" onSubmitEditing={submit} />
      <Button title="Entrar" onPress={submit} loading={loading} disabled={!email || !password} style={{ marginTop: space.sm }} />
      <Button title="Esqueci minha senha" variant="ghost" small onPress={forgot} style={{ marginTop: space.md }} />
    </Screen>
  );
}
