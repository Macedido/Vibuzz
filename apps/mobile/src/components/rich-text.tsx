import { Text, type TextStyle } from 'react-native';
import { colors } from '@/lib/theme';

/** Splits roleplay text into speech and *actions* (rendered italic and dimmer). */
export function splitActions(text: string): { action: boolean; text: string }[] {
  const out: { action: boolean; text: string }[] = [];
  const re = /\*([^*\n][^*]*?)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ action: false, text: text.slice(last, m.index) });
    out.push({ action: true, text: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ action: false, text: text.slice(last) });
  return out;
}

export function RoleplayText({ text, style, actionColor = colors.muted }: { text: string; style?: TextStyle; actionColor?: string }) {
  return (
    <Text style={style} selectable>
      {splitActions(text).map((p, i) =>
        p.action ? (
          <Text key={i} style={{ fontStyle: 'italic', color: actionColor }}>
            {p.text}
          </Text>
        ) : (
          <Text key={i}>{p.text}</Text>
        ),
      )}
    </Text>
  );
}
