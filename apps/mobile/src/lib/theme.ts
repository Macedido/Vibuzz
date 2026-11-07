import { Platform } from 'react-native';

/** Vibuzz design tokens — deep-night background, electric-blue brand from the logo, cyan signal. */
export const colors = {
  bg: '#03041A',
  surface: '#0A0D26',
  raised: '#121738',
  overlay: '#1A2148',
  border: '#232C57',
  borderSoft: '#161C40',
  text: '#F2F5FF',
  textSoft: '#C4CBEA',
  muted: '#8890B8',
  faint: '#545E8C',
  accent: '#2A7DFF',
  accentInk: '#FFFFFF',
  accentSoft: 'rgba(42,125,255,0.16)',
  signal: '#46D5FF',
  signalSoft: 'rgba(70,213,255,0.14)',
  danger: '#FF5C7A',
  dangerSoft: 'rgba(255,92,122,0.12)',
  success: '#3DDC97',
  warning: '#FFC857',
  userBubble: '#1F63F2',
  userBubbleText: '#FFFFFF',
  botBubble: '#0F1330',
} as const;

/** Brand gradient (logo: deep blue -> sky -> cyan). */
export const brandGradient = ['#1340FF', '#2A8CFF', '#4FDCFF'] as const;

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
