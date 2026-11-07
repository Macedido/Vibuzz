import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { EmptyState, ErrorState, Ionicons, Loading, Screen, Segmented } from '@/components/ui';
import { unwrap, useQuery } from '@/lib/hooks';
import { chatImageUrl, supabase } from '@/lib/supabase';
import { colors, radius, space, type } from '@/lib/theme';

interface Item {
  message_id: string;
  path: string;
  role: 'user' | 'assistant';
  created_at: string;
}

function Thumb({ path, size, onPress }: { path: string; size: number; onPress: (uri: string) => void }) {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => void chatImageUrl(path).then(setUri), [path]);
  return (
    <Pressable onPress={() => uri && onPress(uri)} style={{ width: size, height: size * 1.25, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.overlay }}>
      {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} /> : null}
    </Pressable>
  );
}

/** Every image in one conversation: photos the character sent and the ones you sent. */
export default function Gallery() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();
  const [who, setWho] = useState<'assistant' | 'user'>('assistant');
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery(async () => (unwrap(await supabase.rpc('conversation_gallery', { p_conversation: id })) as Item[]) ?? [], [id]);
  if (q.loading) return <Loading />;
  if (q.error) return <ErrorState message={q.error} onRetry={q.refresh} />;
  const items = (q.data ?? []).filter((i) => i.role === who);
  const inner = Math.min(width, 960) - space.lg * 2;
  const cols = inner > 700 ? 5 : inner > 480 ? 4 : 3;
  const size = Math.floor((inner - space.sm * (cols - 1)) / cols);
  return (
    <Screen>
      <View style={{ maxWidth: 960, width: '100%', alignSelf: 'center' }}>
        <Segmented
          value={who}
          onChange={setWho}
          options={[
            { value: 'assistant', label: 'Do personagem' },
            { value: 'user', label: 'Suas' },
          ]}
        />
        <View style={{ height: space.lg }} />
        {items.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {items.map((i) => (
              <Thumb key={i.path} path={i.path} size={size} onPress={setOpen} />
            ))}
          </View>
        ) : (
          <EmptyState
            icon="images-outline"
            title={who === 'assistant' ? 'Nenhuma foto ainda' : 'Você ainda não mandou imagens'}
            message={who === 'assistant' ? 'Peça uma foto na conversa ("me manda uma selfie") ou ligue a vida própria.' : 'Use o clipe no chat para enviar imagens.'}
          />
        )}
        <Text style={[type.small, { marginTop: space.lg }]}>As imagens desta conversa só aparecem para você.</Text>
      </View>
      <Modal visible={Boolean(open)} transparent animationType="fade" onRequestClose={() => setOpen(null)}>
        <Pressable style={styles.viewer} onPress={() => setOpen(null)}>
          {open ? <Image source={{ uri: open }} style={{ width: '100%', height: '85%' }} contentFit="contain" /> : null}
          <View style={styles.close}>
            <Ionicons name="close" size={22} color="#fff" />
          </View>
        </Pressable>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center', padding: space.lg },
  close: { position: 'absolute', top: 40, right: 24, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
});
