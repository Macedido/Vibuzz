import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { mediaUrl } from '@/lib/supabase';
import { colors, radius, space, type } from '@/lib/theme';
import { compact, type CharacterCard } from '@/lib/types';

/** Two-tone gradient picked from the name, so cards without art still look distinct. */
const PALETTES: [string, string][] = [
  ['#3B2A6B', '#14121F'],
  ['#1F4D5A', '#0F1418'],
  ['#5A2443', '#170F15'],
  ['#3E4A1C', '#11140C'],
  ['#5B3A1A', '#18110B'],
  ['#25356B', '#0E1120'],
];
export function paletteFor(name: string): [string, string] {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTES[h % PALETTES.length];
}

/** Full-bleed art (or a generated fallback) used by every card. */
export function CoverArt({ c, style, initialSize = 64 }: { c: Pick<CharacterCard, 'name' | 'avatar_path'>; style?: object; initialSize?: number }) {
  const src = mediaUrl(c.avatar_path);
  if (src) return <Image source={{ uri: src }} style={[StyleSheet.absoluteFill, style]} contentFit="cover" transition={200} />;
  const [a, b] = paletteFor(c.name);
  return (
    <LinearGradient colors={[a, b]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }, style]}>
      <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: initialSize, fontWeight: '900', letterSpacing: -2 }}>{c.name.slice(0, 1).toUpperCase()}</Text>
    </LinearGradient>
  );
}

/** Portrait card: the art fills the card and the text sits on a gradient over it. */
export function PortraitCard({ c, width = 160 }: { c: CharacterCard; width?: number }) {
  const router = useRouter();
  const height = Math.round(width * 1.38);
  return (
    <Pressable
      onPress={() => router.push(`/character/${c.id}`)}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.card, { width, height }, hovered && styles.hovered, pressed && { transform: [{ scale: 0.98 }] }]}
      accessibilityRole="button"
      accessibilityLabel={`${c.name}. ${c.tagline ?? ''}`}
    >
      <CoverArt c={c} initialSize={width * 0.38} />
      <LinearGradient colors={['transparent', 'rgba(8,8,12,0.55)', 'rgba(8,8,12,0.96)']} locations={[0.35, 0.62, 1]} style={StyleSheet.absoluteFill} />
      <View style={styles.badges}>
        {c.kind === 'group' ? (
          <View style={[styles.badge, { backgroundColor: colors.accent }]}>
            <Ionicons name="people" size={10} color={colors.accentInk} />
            <Text style={[styles.badgeText, { color: colors.accentInk }]}>{c.member_count}</Text>
          </View>
        ) : null}
        <View style={{ flex: 1 }} />
        {c.maturity === 'mature' ? (
          <View style={[styles.badge, { backgroundColor: 'rgba(255,92,122,0.9)' }]}>
            <Text style={[styles.badgeText, { color: '#fff' }]}>18+</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={1}>
          {c.name}
        </Text>
        <Text style={styles.tagline} numberOfLines={2}>
          {c.tagline || c.description || ' '}
        </Text>
        <View style={styles.meta}>
          <Ionicons name="chatbubble-ellipses" size={11} color={colors.textSoft} />
          <Text style={styles.metaText}>{compact(c.conversation_count)}</Text>
          <Text style={[styles.metaText, { flex: 1, textAlign: 'right' }]} numberOfLines={1}>
            @{c.creator_username}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

/** Horizontal strip of portrait cards. */
export function Rail({ items, width = 150 }: { items: CharacterCard[]; width?: number }) {
  return (
    <FlatList
      horizontal
      data={items}
      keyExtractor={(c) => c.id}
      renderItem={({ item }) => <PortraitCard c={item} width={width} />}
      ItemSeparatorComponent={() => <View style={{ width: space.md }} />}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingRight: space.lg }}
    />
  );
}

/** Number of columns for a container width (cards stay ~150–210 px wide). */
export function columnsFor(width: number): number {
  if (width >= 1300) return 7;
  if (width >= 1100) return 6;
  if (width >= 880) return 5;
  if (width >= 660) return 4;
  if (width >= 470) return 3;
  return 2;
}

/** Responsive grid that measures its own width (works beside the desktop sidebar). */
export function CharacterGrid({ items, footer }: { items: CharacterCard[]; footer?: ReactNode }) {
  const [w, setW] = useState(0);
  const gap = space.md;
  const cols = columnsFor(w);
  const cardW = w ? Math.floor((w - gap * (cols - 1)) / cols) : 0;
  return (
    <View onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}>
      {cardW ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
          {items.map((c) => (
            <PortraitCard key={c.id} c={c} width={cardW} />
          ))}
        </View>
      ) : null}
      {footer}
    </View>
  );
}

/** Compact row (lists, profile). */
export function CharacterRow({ c, right }: { c: CharacterCard; right?: React.ReactNode }) {
  const router = useRouter();
  return (
    <Pressable onPress={() => router.push(`/character/${c.id}`)} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.raised }]}>
      <View style={styles.rowThumb}>
        <CoverArt c={c} initialSize={22} />
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
  card: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surface },
  hovered: { transform: [{ translateY: -3 }], shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } },
  badges: { position: 'absolute', top: 8, left: 8, right: 8, flexDirection: 'row', alignItems: 'center' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 3 },
  badgeText: { fontSize: 10, fontWeight: '800' },
  text: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 10, paddingBottom: 10, gap: 3 },
  name: { color: '#fff', fontSize: 15, fontWeight: '800', letterSpacing: -0.2 },
  tagline: { color: 'rgba(255,255,255,0.72)', fontSize: 12, lineHeight: 16 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  metaText: { color: colors.textSoft, fontSize: 11, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, borderRadius: radius.md },
  rowThumb: { width: 52, height: 52, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.overlay },
});
