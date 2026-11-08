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

/**
 * Unbounded (wide, chunky display face) gives titles and character names a voice of
 * their own; body text stays on the system UI font for reading comfort.
 */
export const fonts = {
  display: 'Unbounded_800ExtraBold',
  displaySemi: 'Unbounded_600SemiBold',
} as const;

const ui = Platform.select({ ios: 'System', android: undefined, default: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' });

export const type = {
  hero: { fontSize: 32, lineHeight: 38, letterSpacing: -0.6, color: colors.text, fontFamily: fonts.display },
  h1: { fontSize: 22, lineHeight: 28, letterSpacing: -0.3, color: colors.text, fontFamily: fonts.displaySemi },
  h2: { fontSize: 19, fontWeight: '700' as const, letterSpacing: -0.3, color: colors.text, fontFamily: ui },
  h3: { fontSize: 16, fontWeight: '700' as const, color: colors.text, fontFamily: ui },
  body: { fontSize: 15, lineHeight: 22, color: colors.textSoft, fontFamily: ui },
  small: { fontSize: 13, lineHeight: 18, color: colors.muted, fontFamily: ui },
  /** Section labels: plain sentence case, no tracking. */
  tiny: { fontSize: 12, fontWeight: '600' as const, color: colors.muted, fontFamily: ui },
};
