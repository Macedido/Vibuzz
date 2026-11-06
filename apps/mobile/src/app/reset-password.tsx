import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { Banner, Button, Field, Screen } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { space, type } from '@/lib/theme';

export default function ResetPassword() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (password.length < 8) return setError('A senha precisa ter pelo menos 8 caracteres.');
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) return setError('O link expirou. Peça um novo na tela de login.');
    router.replace('/');
  };

  return (
    <Screen keyboard style={{ maxWidth: 520, width: '100%', alignSelf: 'center' }}>
      <Text style={[type.h1, { marginBottom: space.lg }]}>Defina uma nova senha</Text>
      {error ? <Banner tone="danger" text={error} /> : null}
      <Field label="Nova senha" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" />
      <Button title="Salvar senha" onPress={save} loading={saving} />
    </Screen>
  );
}
