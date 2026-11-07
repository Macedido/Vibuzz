import { MIN_AGE } from '@vibuzz/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { Banner, Button, Field, Screen } from '@/components/ui';
import { ageOf, useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { space, type } from '@/lib/theme';
import { maskDate, parseBirthdate } from './(auth)/sign-up';

/** Google sign-ups land here once to give their birthdate (age rules need it). */
export default function CompleteSignup() {
  const router = useRouter();
  const { refresh, signOut, profile } = useAuth();
  const [birth, setBirth] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    const iso = parseBirthdate(birth);
    if (!iso) return setError('Data inválida (use DD/MM/AAAA).');
    if (ageOf(iso) < MIN_AGE) return setError(`O Vibuzz é para pessoas com ${MIN_AGE} anos ou mais.`);
    setLoading(true);
    const { error: e } = await supabase.rpc('complete_signup', { p_birthdate: iso });
    setLoading(false);
    if (e) return setError(/underage/.test(e.message) ? `O Vibuzz é para pessoas com ${MIN_AGE} anos ou mais.` : 'Não foi possível salvar agora.');
    await refresh();
    router.replace('/');
  };

  return (
    <Screen keyboard style={{ maxWidth: 520, width: '100%', alignSelf: 'center' }}>
      <Text style={[type.h1, { marginBottom: space.xs }]}>Oi{profile?.display_name ? `, ${profile.display_name.split(' ')[0]}` : ''}!</Text>
      <Text style={[type.body, { marginBottom: space.xl }]}>Falta só sua data de nascimento. Ela decide quais conteúdos aparecem para você e não fica no seu perfil.</Text>
      {error ? <Banner tone="danger" text={error} /> : null}
      <Field label="Data de nascimento" value={birth} onChangeText={(v) => setBirth(maskDate(v))} keyboardType="number-pad" placeholder="DD/MM/AAAA" onSubmitEditing={submit} />
      <Button title="Começar" onPress={submit} loading={loading} disabled={birth.length < 10} style={{ marginTop: space.sm }} />
      <Button title="Sair" variant="ghost" small onPress={signOut} style={{ marginTop: space.md }} />
    </Screen>
  );
}
