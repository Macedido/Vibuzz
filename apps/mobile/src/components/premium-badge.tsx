import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/lib/theme';

/** Shown next to names of people with an active Premium. */
export function PremiumBadge({ until, size = 'sm' }: { until?: string | null; size?: 'sm' | 'md' }) {
  if (!until || new Date(until).getTime() <= Date.now()) return null;
  return (
    <View style={[styles.badge, size === 'md' && { paddingHorizontal: 9, paddingVertical: 3 }]} accessibilityLabel="Premium">
      <Text style={[styles.text, size === 'md' && { fontSize: 11 }]}>Premium</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, backgroundColor: colors.signalSoft, borderWidth: 1, borderColor: 'rgba(70,213,255,0.35)' },
  text: { color: colors.signal, fontSize: 10, fontFamily: fonts.displaySemi, letterSpacing: 0.2 },
});
