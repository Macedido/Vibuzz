import type { CharacterSheet, VisionAnalysis } from '@vibuzz/shared';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Banner, Button, Card, Field, Ionicons, Row, Screen, Segmented } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { setDraft } from '@/lib/draft';
import { mediaUrl } from '@/lib/supabase';
import { colors, radius, space, type } from '@/lib/theme';
import { pickImage, uploadImage } from '@/lib/upload';

interface GenerateResult {
  sheet?: CharacterSheet;
  members?: CharacterSheet[];
  analyses: { path: string; analysis: VisionAnalysis }[];
  needsClarification: boolean;
  clarificationQuestion?: string;
  notes: string[];
}

const EXAMPLE = 'Um rapaz de 20 anos, muito inteligente, meio arrogante, engraçado e misterioso. Mora numa cidade futurista e não confia facilmente nas pessoas.';

const KIND_LABEL: Record<VisionAnalysis['kind'], string> = {
  single_character: 'Um personagem',
  multiple_characters: 'Várias pessoas',
  scenery: 'Cenário',
  no_reference: 'Sem referência útil',
  ambiguous: 'Imagem ambígua',
};

export default function AiCreate() {
  const router = useRouter();
  const [kind, setKind] = useState<'single' | 'group'>('single');
  const [idea, setIdea] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clarify, setClarify] = useState<GenerateResult | null>(null);

  const addImage = async () => {
    setError(null);
    try {
      const img = await pickImage();
      if (!img) return;
      setUploading(true);
      const path = await uploadImage('media', 'references', img);
      setImages((l) => [...l, path].slice(0, 4));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setUploading(false);
    }
  };

  const generate = async (subjectLabel?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<GenerateResult>('/v1/creator/generate', { body: { idea: idea.trim(), imagePaths: images, subjectLabel, kind } });
      if (res.needsClarification) {
        setClarify(res);
        return;
      }
      setClarify(null);
      const withPerson = res.analyses.find((a) => a.analysis.kind === 'single_character' || a.analysis.kind === 'multiple_characters');
      setDraft({
        kind,
        sheet: res.sheet!,
        members: res.members,
        avatarPath: kind === 'single' && withPerson?.analysis.kind === 'single_character' ? withPerson.path : null,
        imagePaths: images.filter((p) => p !== withPerson?.path || kind === 'group'),
        notes: ['Ficha gerada pela IA. Revise, edite ou regenere campos (✨) antes de salvar.', ...res.notes],
      });
      router.replace('/create/editor');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen keyboard>
      <View style={{ maxWidth: 720, width: '100%', alignSelf: 'center' }}>
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: 'single', label: 'Personagem' },
            { value: 'group', label: 'Grupo' },
          ]}
        />
        <View style={{ height: space.lg }} />
        {error ? <Banner tone="danger" text={error} /> : null}
        <Field
          label="Sua ideia"
          value={idea}
          onChangeText={setIdea}
          multiline
          maxLength={4000}
          placeholder={kind === 'group' ? 'Ex.: Quatro amigos de faculdade que dividem um apartamento caótico…' : EXAMPLE}
          style={{ minHeight: 150 }}
        />
        <Text style={[type.small, { marginBottom: space.md }]}>Seja específico no que importa (idade, jeito, mundo). A IA não contradiz o que você escrever.</Text>

        <Text style={[type.tiny, { marginBottom: space.sm }]}>Imagens de referência (opcional)</Text>
        <Row style={{ flexWrap: 'wrap', marginBottom: space.lg }}>
          {images.map((p) => (
            <View key={p}>
              <Image source={{ uri: mediaUrl(p)! }} style={styles.thumb} />
              <Pressable onPress={() => setImages((l) => l.filter((x) => x !== p))} style={styles.remove}>
                <Ionicons name="close" size={12} color="#fff" />
              </Pressable>
            </View>
          ))}
          {images.length < 4 ? (
            <Pressable onPress={addImage} style={[styles.thumb, styles.add]}>
              {uploading ? <ActivityIndicator color={colors.accent} /> : <Ionicons name="image-outline" size={24} color={colors.muted} />}
            </Pressable>
          ) : null}
        </Row>

        {clarify ? (
          <Card style={{ marginBottom: space.lg, borderColor: colors.signal + '66' }}>
            <Text style={type.h3}>{clarify.clarificationQuestion}</Text>
            {clarify.analyses
              .filter((a) => a.analysis.kind === 'multiple_characters')
              .map((a) => (
                <View key={a.path} style={{ marginTop: space.md }}>
                  <Row style={{ alignItems: 'flex-start' }}>
                    <Image source={{ uri: mediaUrl(a.path)! }} style={{ width: 72, height: 72, borderRadius: radius.sm }} />
                    <Text style={[type.small, { flex: 1 }]}>{a.analysis.summary}</Text>
                  </Row>
                  {a.analysis.subjects.map((s) => (
                    <Pressable key={s.label} onPress={() => generate(s.label)} style={styles.subject}>
                      <Text style={type.h3}>{s.label}</Text>
                      <Text style={type.small} numberOfLines={2}>
                        {[s.observable.hair, s.observable.clothing, s.observable.style].filter(Boolean).join(' · ')}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ))}
          </Card>
        ) : null}

        {clarify?.analyses.length ? (
          <View style={{ marginBottom: space.md }}>
            {clarify.analyses.map((a) => (
              <Text key={a.path} style={type.small}>
                • {KIND_LABEL[a.analysis.kind]}: {a.analysis.summary}
              </Text>
            ))}
          </View>
        ) : null}

        <Button title={loading ? 'Criando ficha…' : 'Gerar ficha'} icon="sparkles" onPress={() => generate()} loading={loading} disabled={idea.trim().length < 3 || uploading} />
        {loading ? <Text style={[type.small, { textAlign: 'center', marginTop: space.md }]}>Isso leva alguns segundos — a IA está montando personalidade, história e voz.</Text> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  thumb: { width: 84, height: 84, borderRadius: radius.md },
  add: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  remove: { position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  subject: { marginTop: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.border },
});
