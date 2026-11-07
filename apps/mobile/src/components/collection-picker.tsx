import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Field, Ionicons, Panel, Row } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { colors, radius, space, type } from '@/lib/theme';

interface Col {
  id: string;
  name: string;
  item_count: number;
  is_public: boolean;
  has: boolean;
}

/** "Salvar em coleção": toggles one character in the viewer's collections, or makes a new one. */
export function CollectionPicker({ characterId, visible, onClose }: { characterId: string; visible: boolean; onClose: () => void }) {
  const { userId } = useAuth();
  const [cols, setCols] = useState<Col[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    if (!userId) return;
    const [{ data: mine }, { data: items }] = await Promise.all([
      supabase.from('collections').select('id, name, item_count, is_public').eq('owner_id', userId).order('updated_at', { ascending: false }),
      supabase.from('collection_items').select('collection_id').eq('character_id', characterId),
    ]);
    const inSet = new Set((items ?? []).map((i: { collection_id: string }) => i.collection_id));
    setCols(((mine ?? []) as Omit<Col, 'has'>[]).map((c) => ({ ...c, has: inSet.has(c.id) })));
  };

  useEffect(() => {
    if (visible) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, characterId, userId]);

  const toggle = async (c: Col) => {
    setBusy(c.id);
    setErr(null);
    const res = c.has
      ? await supabase.from('collection_items').delete().eq('collection_id', c.id).eq('character_id', characterId)
      : await supabase.from('collection_items').insert({ collection_id: c.id, character_id: characterId });
    if (res.error) setErr('Não deu para salvar agora.');
    else setCols((l) => l?.map((x) => (x.id === c.id ? { ...x, has: !x.has, item_count: x.item_count + (x.has ? -1 : 1) } : x)) ?? null);
    setBusy(null);
  };

  const create = async () => {
    const n = name.trim();
    if (!n || !userId) return;
    setBusy('new');
    setErr(null);
    const { data, error } = await supabase.from('collections').insert({ owner_id: userId, name: n.slice(0, 60) }).select('id').single();
    if (!error && data) {
      await supabase.from('collection_items').insert({ collection_id: data.id, character_id: characterId });
      setName('');
      await load();
    } else setErr('Não deu para criar a coleção.');
    setBusy(null);
  };

  return (
    <Panel visible={visible} onClose={onClose} title="Salvar em coleção">
      {err ? <Text style={[type.small, { color: colors.danger, marginBottom: space.sm }]}>{err}</Text> : null}
      {!cols ? (
        <ActivityIndicator color={colors.accent} style={{ marginVertical: space.lg }} />
      ) : (
        <View style={{ gap: space.sm, marginBottom: space.lg }}>
          {cols.length === 0 ? <Text style={type.small}>Você ainda não tem coleções. Crie a primeira abaixo.</Text> : null}
          {cols.map((c) => (
            <Pressable key={c.id} onPress={() => toggle(c)} disabled={busy === c.id} style={[styles.row, c.has && { borderColor: colors.accent }]}>
              <Ionicons name={c.has ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={c.has ? colors.accent : colors.faint} />
              <View style={{ flex: 1 }}>
                <Text style={type.h3}>{c.name}</Text>
                <Text style={type.small}>
                  {c.item_count} {c.item_count === 1 ? 'personagem' : 'personagens'}
                  {c.is_public ? '' : ' · privada'}
                </Text>
              </View>
              {busy === c.id ? <ActivityIndicator color={colors.accent} size="small" /> : null}
            </Pressable>
          ))}
        </View>
      )}
      <Row style={{ alignItems: 'flex-end', marginBottom: space.md }}>
        <View style={{ flex: 1 }}>
          <Field label="Nova coleção" value={name} onChangeText={setName} maxLength={60} placeholder="Ex.: Vilões favoritos" />
        </View>
        <Button title="Criar" small onPress={create} loading={busy === 'new'} disabled={!name.trim()} style={{ marginBottom: space.md }} />
      </Row>
    </Panel>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderSoft, backgroundColor: colors.surface },
});
