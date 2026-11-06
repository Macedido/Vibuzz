import { personaSchema } from '@vibuzz/shared';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Avatar, Banner, Button, Field, Ionicons, Loading, Row, Screen } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { colors, space } from '@/lib/theme';
import type { Persona } from '@/lib/types';
import { pickImage, uploadImage } from '@/lib/upload';

const EMPTY = { name: '', gender: '', age: '', biography: '', personality: '', appearance: '', history: '', extra: '' };

export default function PersonaEdit() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const { userId } = useAuth();
  const [form, setForm] = useState(EMPTY);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(id));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    supabase
      .from('personas')
      .select('*')
      .eq('id', id)
      .maybeSingle()
      .then(({ data }) => {
        const p = data as Persona | null;
        if (p) {
          setForm({ name: p.name, gender: p.gender, age: p.age, biography: p.biography, personality: p.personality, appearance: p.appearance, history: p.history, extra: p.extra });
          setAvatar(p.avatar_path);
        }
        setLoading(false);
      });
  }, [id]);

  const set = (k: keyof typeof EMPTY) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    const parsed = personaSchema.safeParse(form);
    if (!parsed.success) return setError('Dê um nome para a persona.');
    setSaving(true);
    setError(null);
    const row = { ...parsed.data, avatar_path: avatar };
    const res = id ? await supabase.from('personas').update(row).eq('id', id) : await supabase.from('personas').insert({ ...row, owner_id: userId });
    setSaving(false);
    if (res.error) return setError('Não foi possível salvar.');
    router.back();
  };

  const changeAvatar = async () => {
    try {
      const img = await pickImage({ square: true });
      if (!img) return;
      setUploading(true);
      setAvatar(await uploadImage('media', 'personas', img));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setUploading(false);
    }
  };

  if (loading) return <Loading />;

  return (
    <Screen keyboard>
      <Stack.Screen options={{ title: id ? 'Editar persona' : 'Nova persona' }} />
      <View style={{ maxWidth: 720, width: '100%', alignSelf: 'center' }}>
        {error ? <Banner tone="danger" text={error} /> : null}
        <Pressable onPress={changeAvatar} style={{ alignSelf: 'center', marginBottom: space.lg }}>
          <Avatar path={avatar} name={form.name || '?'} size={96} />
          <View style={{ position: 'absolute', right: 0, bottom: 0, width: 30, height: 30, borderRadius: 15, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
            {uploading ? <ActivityIndicator size="small" color={colors.accentInk} /> : <Ionicons name="camera" size={16} color={colors.accentInk} />}
          </View>
        </Pressable>
        <Field label="Nome" value={form.name} onChangeText={set('name')} maxLength={120} />
        <Row style={{ alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Field label="Gênero" value={form.gender} onChangeText={set('gender')} maxLength={120} />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Idade" hint="opcional" value={form.age} onChangeText={set('age')} maxLength={120} />
          </View>
        </Row>
        <Field label="Aparência" value={form.appearance} onChangeText={set('appearance')} multiline maxLength={1200} />
        <Field label="Personalidade" value={form.personality} onChangeText={set('personality')} multiline maxLength={1200} />
        <Field label="Biografia" value={form.biography} onChangeText={set('biography')} multiline maxLength={6000} />
        <Field label="História" value={form.history} onChangeText={set('history')} multiline maxLength={6000} />
        <Field label="Descrição adicional" value={form.extra} onChangeText={set('extra')} multiline maxLength={1200} />
        <Button title="Salvar persona" onPress={save} loading={saving} style={{ marginTop: space.md }} />
      </View>
    </Screen>
  );
}
