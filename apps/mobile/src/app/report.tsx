import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Banner, Button, Field, Ionicons, Row, Screen } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { colors, space, type } from '@/lib/theme';

const REASONS = [
  ['sexual_minors', 'Envolve menores de forma sexual'],
  ['sexual', 'Conteúdo sexual'],
  ['violence', 'Violência ou ameaça'],
  ['hate', 'Discurso de ódio'],
  ['harassment', 'Assédio'],
  ['self_harm', 'Autolesão'],
  ['impersonation', 'Se passa por pessoa real'],
  ['copyright', 'Direitos autorais'],
  ['spam', 'Spam'],
  ['other', 'Outro motivo'],
] as const;

export default function Report() {
  const { type: targetType, id } = useLocalSearchParams<{ type: 'character' | 'comment' | 'user' | 'message'; id: string }>();
  const router = useRouter();
  const { userId } = useAuth();
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!reason) return;
    setSending(true);
    const { error } = await supabase.from('reports').insert({ reporter_id: userId, target_type: targetType, target_id: id, reason, details: details.trim() });
    setSending(false);
    if (error) return setError('Não foi possível enviar a denúncia.');
    setDone(true);
  };

  if (done) {
    return (
      <Screen>
        <Text style={type.h1}>Obrigado</Text>
        <Text style={[type.body, { marginVertical: space.lg }]}>Nossa equipe vai analisar. Você também pode bloquear o autor pelo perfil dele.</Text>
        <Button title="Fechar" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen keyboard>
      <View style={{ maxWidth: 560, width: '100%', alignSelf: 'center' }}>
        {error ? <Banner tone="danger" text={error} /> : null}
        <Text style={[type.body, { marginBottom: space.md }]}>Qual é o problema?</Text>
        {REASONS.map(([value, label]) => (
          <Pressable key={value} onPress={() => setReason(value)}>
            <Row style={{ paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: colors.borderSoft }}>
              <Ionicons name={reason === value ? 'radio-button-on' : 'radio-button-off'} size={20} color={reason === value ? colors.accent : colors.muted} />
              <Text style={type.body}>{label}</Text>
            </Row>
          </Pressable>
        ))}
        <View style={{ height: space.lg }} />
        <Field label="Detalhes" hint="opcional" value={details} onChangeText={setDetails} multiline maxLength={1000} />
        <Button title="Enviar denúncia" onPress={submit} loading={sending} disabled={!reason} />
      </View>
    </Screen>
  );
}
