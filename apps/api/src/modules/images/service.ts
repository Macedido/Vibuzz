import type { CharacterSheet } from '@vibuzz/shared';
import type { Db } from '../../lib/db';
import { AppError } from '../../lib/errors';
import type { AiService } from '../ai/service';
import { renderSheet, sheetSuggestsMinor } from '../intelligence/prompts';

export const PORTRAIT_STYLES = {
  anime: 'anime illustration, clean line art, vibrant colors, detailed eyes',
  realista: 'realistic digital painting, cinematic lighting, detailed',
  '3d': '3D render, stylized character, soft studio lighting',
  fantasia: 'fantasy concept art, painterly, dramatic lighting',
} as const;
export type PortraitStyle = keyof typeof PORTRAIT_STYLES;

const SAFE = 'safe for work, fully clothed, no nudity, no gore, no text, no watermark';

/**
 * Character portraits with a free, keyless image model (Pollinations).
 * The prompt is written in English by a fast model from the sheet; the image is
 * stored in the public media bucket and still goes through image moderation when
 * the character is saved.
 */
export interface GeminiImageConfig {
  apiKey: string;
  /** Model URL bases to try (Vertex express for "AQ." keys, Gemini API for "AIza" keys). */
  bases: string[];
  models?: string[];
}

/** Gemini image models, best first; unknown ones are skipped (404). */
export const GEMINI_IMAGE_MODELS = ['gemini-2.5-flash-image', 'gemini-3.1-flash-image-preview'];

function aspectFor(width: number, height: number): string {
  const r = width / height;
  const options: [string, number][] = [
    ['1:1', 1],
    ['4:5', 0.8],
    ['3:4', 0.75],
    ['2:3', 0.667],
    ['9:16', 0.5625],
    ['5:4', 1.25],
    ['4:3', 1.333],
    ['16:9', 1.778],
  ];
  return options.reduce((best, o) => (Math.abs(o[1] - r) < Math.abs(best[1] - r) ? o : best))[0];
}

function fromB64(data: string): Uint8Array {
  const bin = atob(data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export class ImageService {
  constructor(
    private ai: AiService,
    private db: Db,
    private opts: { baseUrl: string; fetch?: typeof fetch; gemini?: GeminiImageConfig; log?: (msg: string, extra?: object) => void } = {
      baseUrl: 'https://image.pollinations.ai',
    },
  ) {}

  async portraitPrompt(sheet: CharacterSheet, style: PortraitStyle, userId: string): Promise<string> {
    const minor = sheetSuggestsMinor(sheet);
    const subject = sheet.mode === 'narrator' ? 'a cover image for this interactive story: its setting and main cast' : 'a portrait of this character, upper body, facing the viewer';
    let prompt = '';
    try {
      const out = await this.ai.complete(
        'fast',
        {
          system: {
            stable: `You write prompts for an image generator. Describe ${subject} in ONE English paragraph of at most 70 words: species/body, hair, eyes, clothing, expression, pose, setting, lighting. Use only what the sheet says or clearly implies; never add real people's names or brand logos. ${
              minor ? 'The character is a minor: depict them age-appropriately and never suggestively. ' : ''
            }No sexual content. Output only the prompt.`,
          },
          messages: [{ role: 'user', content: renderSheet(sheet.name, sheet) }],
          maxTokens: 220,
          temperature: 0.6,
        },
        { userId, kind: 'portrait_prompt' },
      );
      prompt = out.text.replace(/\s+/g, ' ').replace(/^["']|["']$/g, '').trim();
    } catch {
      // The image model can still work from the raw appearance text.
    }
    if (!prompt) prompt = [sheet.name, sheet.appearance, sheet.universe].filter(Boolean).join(', ');
    return `${prompt.slice(0, 700)}. ${PORTRAIT_STYLES[style]}, ${SAFE}`;
  }

  /** Generates a portrait and stores it under "<userId>/characters/". Returns the storage path. */
  async generatePortrait(sheet: CharacterSheet, style: PortraitStyle, userId: string): Promise<{ path: string; prompt: string }> {
    const prompt = await this.portraitPrompt(sheet, style, userId);
    return { path: await this.render(prompt, 'media', `${userId}/characters/ai`, 768, 1024), prompt };
  }

  /**
   * A photo the character sends in the chat ("[foto: ...]"). The character's look is
   * added so the same person appears across photos; stored in the private chat bucket.
   */
  async generateChatPhoto(opts: {
    userId: string;
    conversationId: string;
    description: string;
    sheet: CharacterSheet;
    style?: PortraitStyle;
    size?: { width: number; height: number };
    /** Character avatar in the media bucket: keeps the same face across photos. */
    referencePath?: string | null;
  }): Promise<string> {
    const look = [opts.sheet.mode === 'narrator' ? '' : opts.sheet.appearance, opts.sheet.universe].filter(Boolean).join('. ').slice(0, 360);
    const minor = sheetSuggestsMinor(opts.sheet) ? 'age-appropriate, non-suggestive, ' : '';
    const prompt = `${opts.description.slice(0, 400)}. ${look ? `Character look: ${look}. ` : ''}${minor}${PORTRAIT_STYLES[opts.style ?? 'anime']}, ${SAFE}`;
    const reference = opts.referencePath ? await this.loadReference(opts.referencePath) : null;
    return this.render(prompt, 'chat', `${opts.userId}/${opts.conversationId}/foto`, opts.size?.width ?? 768, opts.size?.height ?? 960, reference);
  }

  private async loadReference(path: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
    try {
      const { data } = await this.db.storage.from('media').download(path);
      if (!data) return null;
      const bytes = new Uint8Array(await data.arrayBuffer());
      const mime = imageMime(bytes);
      return mime && bytes.byteLength < 4_000_000 ? { bytes, mime } : null;
    } catch {
      return null;
    }
  }

  /**
   * Gemini image model (sharp, coherent anatomy; follows a reference picture).
   * Returns null when it is not configured or not available, so the caller can fall back.
   */
  private async gemini(prompt: string, width: number, height: number, reference: { bytes: Uint8Array; mime: string } | null): Promise<Uint8Array | null> {
    const g = this.opts.gemini;
    if (!g) return null;
    const doFetch = this.opts.fetch ?? fetch;
    const text = reference
      ? `Create a new picture of the character shown in the attached reference image (same face, hair, body type, colors and art style). Scene: ${prompt}`
      : `Create a picture. ${prompt}`;
    const body = JSON.stringify({
      contents: [{ role: 'user', parts: [...(reference ? [{ inlineData: { mimeType: reference.mime, data: toB64(reference.bytes) } }] : []), { text }] }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: aspectFor(width, height) } },
    });
    for (const base of g.bases) {
      for (const model of g.models ?? GEMINI_IMAGE_MODELS) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 70_000);
        try {
          const res = await doFetch(`${base}/${model}:generateContent`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-goog-api-key': g.apiKey },
            body,
            signal: ctrl.signal,
          });
          if (res.status === 404 || res.status === 400) continue; // model not offered here
          if (res.status === 401 || res.status === 403) break; // key not valid for this base
          if (!res.ok) {
            this.opts.log?.('gemini image failed', { status: res.status, model });
            return null; // quota or overload: use the backup generator
          }
          const json = (await res.json()) as { candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[] };
          const data = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
          if (!data) {
            this.opts.log?.('gemini image empty (likely safety)', { model });
            return null;
          }
          return fromB64(data);
        } catch (e) {
          this.opts.log?.('gemini image error', { model, err: String((e as Error).message) });
          return null;
        } finally {
          clearTimeout(timer);
        }
      }
    }
    return null;
  }

  private async pollinations(prompt: string, width: number, height: number): Promise<Uint8Array> {
    const seed = Math.floor(Math.random() * 1_000_000_000);
    const url = `${this.opts.baseUrl}/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&nologo=true&safe=true&model=flux&enhance=true&seed=${seed}`;
    const doFetch = this.opts.fetch ?? fetch;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 100_000);
    try {
      const res = await doFetch(url, { signal: ctrl.signal, headers: { accept: 'image/*' } });
      if (!res.ok) throw new AppError(502, 'image_failed', res.status === 429 ? 'O gerador de imagens grátis está ocupado. Tente de novo em um minuto.' : 'Não foi possível gerar a imagem agora.');
      return new Uint8Array(await res.arrayBuffer());
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError(504, 'image_timeout', 'O gerador de imagens demorou demais. Tente de novo.');
    } finally {
      clearTimeout(timer);
    }
  }

  private async render(
    prompt: string,
    bucket: 'media' | 'chat',
    prefix: string,
    width: number,
    height: number,
    reference: { bytes: Uint8Array; mime: string } | null = null,
  ): Promise<string> {
    const bytes = (await this.gemini(prompt, width, height, reference)) ?? (await this.pollinations(prompt, width, height));
    const mime = imageMime(bytes);
    if (!mime || bytes.byteLength < 2000 || bytes.byteLength > 12_000_000) throw new AppError(502, 'image_failed', 'O gerador devolveu uma imagem inválida. Tente de novo.');
    const tag = Math.floor(Math.random() * 1_000_000_000).toString(36);
    const path = `${prefix}-${Date.now().toString(36)}-${tag}.${mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'}`;
    const { error } = await this.db.storage.from(bucket).upload(path, bytes, { contentType: mime, upsert: false });
    if (error) throw new AppError(500, 'upload_failed', 'Falha ao salvar a imagem gerada.');
    return path;
  }

  /** Photos generated today in this user's conversations (plan limit). */
  async photosToday(userId: string): Promise<number> {
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    const { data: convs } = await this.db.from('conversations').select('id').eq('user_id', userId).gte('last_message_at', since.toISOString()).limit(300);
    const ids = (convs ?? []).map((c: { id: string }) => c.id);
    if (!ids.length) return 0;
    const { count } = await this.db
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .in('conversation_id', ids)
      .eq('role', 'assistant')
      .gte('created_at', since.toISOString())
      .neq('image_paths', '{}');
    return count ?? 0;
  }
}

export function imageMime(b: Uint8Array): string | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return 'image/webp';
  return null;
}
