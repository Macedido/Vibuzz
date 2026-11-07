import * as Speech from 'expo-speech';
import { ExpoSpeechRecognitionModule, ExpoWebSpeechRecognition } from 'expo-speech-recognition';
import { Platform } from 'react-native';

export interface VoiceStyle {
  gender?: 'auto' | 'feminina' | 'masculina';
  pitch?: number;
  rate?: number;
}

const FEMALE = /(female|mulher|feminin|maria|luciana|francisca|helena|thalita|vit[oó]ria|camila|joana|leila|raquel|fernanda|google português)/i;
const MALE = /(male|homem|masculin|daniel|ant[oô]nio|felipe|ricardo|donato|fabio|humberto|julio|nicolau|valerio)/i;

let voices: Speech.Voice[] | null = null;
async function ptVoices(): Promise<Speech.Voice[]> {
  if (voices?.length) return voices;
  const all = await Speech.getAvailableVoicesAsync().catch(() => [] as Speech.Voice[]);
  const pt = all.filter((v) => /^pt/i.test(v.language));
  voices = pt.length ? pt : all;
  return voices;
}

function hash(s: string): number {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** What gets read aloud: speech and narration, without markup or photo lines. */
export function speakable(text: string): string {
  return text
    .replace(/\[(?:foto|photo|imagem|image|selfie)\s*:[^\]]*\]?/gi, '')
    .replace(/\*([^*]+)\*/g, '$1.')
    .replace(/[_~`#>]/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Speaks as a character. Each character id keeps the same device voice. */
export async function speak(text: string, opts: { characterId: string; style?: VoiceStyle; genderHint?: string; onDone?: () => void }) {
  const clean = speakable(text);
  if (!clean) return opts.onDone?.();
  Speech.stop();
  const list = await ptVoices();
  const wanted = opts.style?.gender && opts.style.gender !== 'auto' ? opts.style.gender : /fem|mulher|garota|menina|female/i.test(opts.genderHint ?? '') ? 'feminina' : /masc|homem|garoto|menino|male/i.test(opts.genderHint ?? '') ? 'masculina' : null;
  const pool = wanted ? list.filter((v) => (wanted === 'feminina' ? FEMALE : MALE).test(`${v.name} ${v.identifier}`)) : [];
  const candidates = pool.length ? pool : list;
  const voice = candidates.length ? candidates[hash(opts.characterId) % candidates.length] : undefined;
  const basePitch = wanted === 'feminina' && !pool.length ? 1.2 : wanted === 'masculina' && !pool.length ? 0.8 : 1;
  Speech.speak(clean, {
    language: voice?.language ?? 'pt-BR',
    voice: voice?.identifier,
    pitch: Math.max(0.5, Math.min(2, (opts.style?.pitch ?? 1) * basePitch)),
    rate: Math.max(0.5, Math.min(1.8, opts.style?.rate ?? 1)),
    onDone: opts.onDone,
    onStopped: opts.onDone,
    onError: () => opts.onDone?.(),
  });
}

export function stopSpeaking() {
  Speech.stop();
}

/* ----------------------- voice call (speech recognition) ----------------------- */

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

export function canCall(): boolean {
  if (Platform.OS !== 'web') {
    try {
      return ExpoSpeechRecognitionModule.isRecognitionAvailable();
    } catch {
      return false;
    }
  }
  if (typeof window === 'undefined') return false;
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition);
}

/** Microphone + speech permission on Android/iOS (the browser asks by itself). */
export async function askMicrophone(): Promise<boolean> {
  if (Platform.OS === 'web') return true;
  const r = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
  return r.granted;
}

/** Listens once and resolves with what the person said ('' on silence). */
export function listenOnce(lang = 'pt-BR', onPartial?: (t: string) => void): { promise: Promise<string>; stop: () => void } {
  const w = (typeof window === 'undefined' ? {} : window) as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  // On Android/iOS the package exposes the same interface as the browser API.
  const Ctor = Platform.OS === 'web' ? (w.SpeechRecognition ?? w.webkitSpeechRecognition) : (ExpoWebSpeechRecognition as unknown as new () => Recognition);
  if (!Ctor) return { promise: Promise.resolve(''), stop: () => {} };
  const rec = new Ctor();
  rec.lang = lang;
  rec.interimResults = true;
  rec.continuous = false;
  let finalText = '';
  const promise = new Promise<string>((resolve, reject) => {
    rec.onresult = (e) => {
      let interim = '';
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      onPartial?.((finalText + ' ' + interim).trim());
    };
    rec.onerror = (e) => (e.error === 'no-speech' || e.error === 'aborted' ? resolve(finalText.trim()) : reject(new Error(e.error)));
    rec.onend = () => resolve(finalText.trim());
  });
  rec.start();
  return { promise, stop: () => rec.stop() };
}
