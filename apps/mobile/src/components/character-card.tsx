import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { mediaUrl } from '@/lib/supabase';
import { colors, radius, space, type } from '@/lib/theme';
import { compact, type CharacterCard } from '@/lib/types';

function Cover({ c, height }: { c: CharacterCard; height: number }) {
  const src = mediaUrl(c.avatar_path);
  return (
    <View style={{ height, backgroundColor: colors.overlay }}>
      {src ? (
        <Image source={{ uri: src }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
      ) : (
        <LinearGradient colors={['#2B2350', '#13131B']} style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
          <Text style={{ color: colors.signal, fontSize: height * 0.32, fontWeight: '900' }}>{c.name.slice(0, 1).toUpperCase()}</Text>
        </LinearGradient>
      )}
      <LinearGradient colors={['transparent', 'rgba(10,10,15,0.95)']} style={[StyleSheet.absoluteFill, { top: height * 0.45 }]} />
      {c.kind === 'group' ? (
        <View style={styles.groupBadge}>
          <Ionicons name="people" size={11} color={colors.accentInk} />
          <Text style={{ color: colors.accentInk, fontSize: 11, fontWeight: '800' }}>{c.member_count}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** Tall poster card used in horizontal rails. */
export function PosterCard({ c, width = 150 }: { c: CharacterCard; width?: number }) {
  const router = useRouter();
  const height = width * 1.35;
  return (
    <Pressable onPress={() => router.push(`/character/${c.id}`)} style={({ pressed }) => [styles.poster, { width }, pressed && { opacity: 0.85 }]}>
      <Cover c={c} height={height} />
      <View style={styles.posterText}>
        <Text style={type.h3} numberOfLines={1}>
          {c.name}
        </Text>
        <Text style={[type.small, { fontSize: 12 }]} numberOfLines={2}>
          {c.tagline || c.description || `por @${c.creator_username}`}
        </Text>
        <View style={styles.meta}>
          <Ionicons name="chatbubble" size={11} color={colors.muted} />
          <Text style={styles.metaText}>{compact(c.conversation_count)}</Text>
          <Ionicons name="heart" size={11} color={colors.muted} style={{ marginLeft: 6 }} />
          <Text style={styles.metaText}>{compact(c.like_count)}</Text>
        </View>
      </View>
    </Pressable>
  );
}

export function Rail({ items }: { items: CharacterCard[] }) {
  return (
    <FlatList
      horizontal
      data={items}
      keyExtractor={(c) => c.id}
      renderItem={({ item }) => <PosterCard c={item} />}
      ItemSeparatorComponent={() => <View style={{ width: space.md }} />}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingRight: space.lg }}
    />
  );
}

/** Large hero card for the top recommendation. */
export function HeroCard({ c }: { c: CharacterCard }) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const w = Math.min(width - space.lg * 2, 640);
  return (
    <Pressable onPress={() => router.push(`/character/${c.id}`)} style={[styles.hero, { width: w }]}>
      <Cover c={c} height={w * 0.62} />
      <View style={styles.heroText}>
        <Text style={type.tiny}>Para você</Text>
        <Text style={[type.h1, { marginTop: 4 }]} numberOfLines={1}>
          {c.name}
        </Text>
        <Text style={type.body} numberOfLines={2}>
          {c.tagline || c.description}
        </Text>
      </View>
    </Pressable>
  );
}

/** Responsive two/three-column grid for discovery results. */
export function CharacterGrid({ items }: { items: CharacterCard[] }) {
  const { width } = useWindowDimensions();
  const cols = width > 900 ? 4 : width > 600 ? 3 : 2;
  const cardW = (Math.min(width, 1100) - space.lg * 2 - space.md * (cols - 1)) / cols;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
      {items.map((c) => (
        <PosterCard key={c.id} c={c} width={cardW} />
      ))}
    </View>
  );
}

/** Compact row (lists, profile). */
export function CharacterRow({ c, right }: { c: CharacterCard; right?: React.ReactNode }) {
  const router = useRouter();
  const src = mediaUrl(c.avatar_path);
  return (
    <Pressable onPress={() => router.push(`/character/${c.id}`)} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.raised }]}>
      <View style={styles.rowThumb}>
        {src ? <Image source={{ uri: src }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Text style={{ color: colors.signal, fontWeight: '900', fontSize: 20 }}>{c.name[0]}</Text>}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={type.h3} numberOfLines={1}>
          {c.name}
        </Text>
        <Text style={type.small} numberOfLines={1}>
          {c.visibility !== 'public' ? (c.visibility === 'private' ? '🔒 Privado · ' : '🔗 Não listado · ') : ''}
          {c.tagline || c.description || 'Sem descrição'}
        </Text>
      </View>
      {right}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  poster: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSoft },
  posterText: { padding: space.sm + 2, gap: 3 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  metaText: { color: colors.muted, fontSize: 11, fontWeight: '600' },
  groupBadge: { position: 'absolute', top: 8, left: 8, flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 3 },
  hero: { borderRadius: radius.xl, overflow: 'hidden', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignSelf: 'center' },
  heroText: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: space.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, borderRadius: radius.md },
  rowThumb: { width: 52, height: 52, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center' },
});
