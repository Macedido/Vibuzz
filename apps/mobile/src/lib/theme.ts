import { Platform } from 'react-native';

/** Vibuzz design tokens — ink background, acid-lime accent, lilac signal. */
export const colors = {
  bg: '#0A0A0F',
  surface: '#12121A',
  raised: '#1A1A25',
  overlay: '#22222F',
  border: '#2A2A38',
  borderSoft: '#1F1F2B',
  text: '#F3F3F7',
  textSoft: '#C9C9D6',
  muted: '#8C8CA1',
  faint: '#5C5C70',
  accent: '#C8FF4D',
  accentInk: '#0A0A0F',
  accentSoft: 'rgba(200,255,77,0.12)',
  signal: '#9D8CFF',
  signalSoft: 'rgba(157,140,255,0.14)',
  danger: '#FF5C7A',
  dangerSoft: 'rgba(255,92,122,0.12)',
  success: '#4ADE80',
  warning: '#FFC857',
  userBubble: '#C8FF4D',
  userBubbleText: '#0A0A0F',
  botBubble: '#181823',
} as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

const display = Platform.select({ ios: 'System', android: 'sans-serif-condensed', default: 'system-ui' });

export const type = {
  hero: { fontSize: 34, fontWeight: '800' as const, letterSpacing: -1.2, color: colors.text, fontFamily: display },
  h1: { fontSize: 26, fontWeight: '800' as const, letterSpacing: -0.8, color: colors.text, fontFamily: display },
  h2: { fontSize: 20, fontWeight: '700' as const, letterSpacing: -0.4, color: colors.text },
  h3: { fontSize: 16, fontWeight: '700' as const, color: colors.text },
  body: { fontSize: 15, lineHeight: 22, color: colors.textSoft },
  small: { fontSize: 13, lineHeight: 18, color: colors.muted },
  tiny: { fontSize: 11, fontWeight: '600' as const, letterSpacing: 0.6, color: colors.muted, textTransform: 'uppercase' as const },
};
