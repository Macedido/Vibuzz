import type { CharacterSheet } from '@vibuzz/shared';
import * as DocumentPicker from 'expo-document-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Banner, Button, Field, Ionicons, Row, Screen } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { setDraft } from '@/lib/draft';
import { parseCharacterFile, cardToSheet } from '@/lib/import-card';
import { supabase } from '@/lib/supabase';
import { colors, radius, space, type } from '@/lib/theme';

/** Uploads the PNG of a card as the character's avatar (the image is the card). */
async function uploadCardImage(bytes: Uint8Array): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId || bytes.byteLength > 9_500_000) return null;
  const path = `${userId}/characters/import-${Date.now().toString(36)}.png`;
  const { error } = await supabase.storage.from('media').upload(path, bytes, { contentType: 'image/png', upsert: false });
  return error ? null : path;
}

const SOURCES = ['SillyTavern', 'Chub', 'TavernAI', 'Character Card V2/V3'];

/** Brings characters from other apps: card files (.json / .png) or any written sheet. */
export default function ImportCharacter() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<'file' | 'text' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openEditor = (sheet: CharacterSheet, extra: { tags?: string[]; avatarPath?: string | null; note: string }) => {
    setDraft({ kind: 'single', sheet, tags: extra.tags, avatarPath: extra.avatarPath ?? null, notes: [extra.note] });
    router.replace('/create/editor');
  };

  const pickFile = async () => {
    setError(null);
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'image/png', 'text/plain'], copyToCacheDirectory: true, multiple: false });
      if (res.canceled || !res.assets?.[0]) return;
      setBusy('file');
      const asset = res.assets[0];
      const bytes = new Uint8Array(await (asset.file ? asset.file.arrayBuffer() : (await fetch(asset.uri)).arrayBuffer()));
      const card = parseCharacterFile(bytes, asset.name ?? 'ficha');
      const isPng = bytes[0] === 137 && bytes[1] === 80;
      const avatarPath = isPng ? await uploadCardImage(bytes) : null;
      openEditor(card.sheet, {
        tags: card.tags,
        avatarPath,
        note: `Importado de ${card.source}. Confira a ficha: {{user}} e {{char}} continuam funcionando.`,
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const fromText = async () => {
    const raw = text.trim();
    if (raw.length < 20) return setError('Cole a ficha inteira (pelo menos algumas linhas).');
    setError(null);
    setBusy('text');
    try {
      if (raw.startsWith('{')) {
        try {
          const card = cardToSheet(JSON.parse(raw));
          return openEditor(card.sheet, { tags: card.tags, note: `Importado de ${card.source}.` });
        } catch {
          // Not a card: the AI reads it as free text below.
        }
      }
      const res = await api<{ sheet?: CharacterSheet; notes: string[] }>('/v1/creator/generate', {
        body: { idea: `Converta esta ficha de personagem para o formato do Vibuzz, sem inventar o que contradiz o texto e mantendo nomes, idade e mundo:\n\n${raw.slice(0, 3800)}`, imagePaths: [], kind: 'single' },
      });
      if (!res.sheet) throw new Error('Não consegui ler essa ficha. Tente colar só a parte do personagem.');
      openEditor(res.sheet, { note: 'A IA organizou sua ficha nos campos. Revise antes de salvar.' });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen keyboard>
      <View style={{ maxWidth: 720, width: '100%', alignSelf: 'center' }}>
        {error ? <Banner tone="danger" text={error} /> : null}
        <Pressable onPress={pickFile} disabled={!!busy} style={({ pressed }) => [styles.drop, pressed && { opacity: 0.85 }]}>
          {busy === 'file' ? <ActivityIndicator color={colors.accent} /> : <Ionicons name="document-attach-outline" size={30} color={colors.accent} />}
          <Text style={[type.h3, { marginTop: space.sm }]}>Escolher arquivo da ficha</Text>
          <Text style={[type.small, { textAlign: 'center' }]}>.json ou .png de cartão de personagem. O PNG vira a foto do personagem.</Text>
          <Row gap={6} style={{ flexWrap: 'wrap', justifyContent: 'center', marginTop: space.sm }}>
            {SOURCES.map((s) => (
              <Text key={s} style={styles.pill}>
                {s}
              </Text>
            ))}
          </Row>
        </Pressable>

        <Text style={[type.tiny, { marginTop: space.xl, marginBottom: space.sm }]}>Ou cole a ficha</Text>
        <Field
          label="Texto ou JSON"
          value={text}
          onChangeText={setText}
          multiline
          maxLength={12000}
          placeholder={'Nome: Kael\nIdade: 24\nPersonalidade: calmo, observador…\nHistória: …'}
          style={{ minHeight: 180 }}
        />
        <Text style={[type.small, { marginBottom: space.md }]}>Serve ficha de RPG, descrição de wiki, texto de outro app. A IA separa nos campos e você revisa tudo antes de publicar.</Text>
        <Button title="Importar texto" icon="sparkles" onPress={fromText} loading={busy === 'text'} disabled={!!busy} />
        <Text style={[type.small, { marginTop: space.lg, color: colors.faint }]}>Só importe personagens que você criou ou que o autor liberou para uso.</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  drop: {
    alignItems: 'center',
    gap: 4,
    padding: space.xl,
    borderRadius: radius.xl,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.accent + '88',
    backgroundColor: colors.accent + '0D',
  },
  pill: { fontSize: 11, color: colors.textSoft, backgroundColor: colors.overlay, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, overflow: 'hidden' },
});
