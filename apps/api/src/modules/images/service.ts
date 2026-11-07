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
export class ImageService {
  constructor(
    private ai: AiService,
    private db: Db,
    private opts: { baseUrl: string; fetch?: typeof fetch } = { baseUrl: 'https://image.pollinations.ai' },
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
  async generateChatPhoto(opts: { userId: string; conversationId: string; description: string; sheet: CharacterSheet; style?: PortraitStyle }): Promise<string> {
    const look = [opts.sheet.mode === 'narrator' ? '' : opts.sheet.appearance, opts.sheet.universe].filter(Boolean).join('. ').slice(0, 360);
    const minor = sheetSuggestsMinor(opts.sheet) ? 'age-appropriate, non-suggestive, ' : '';
    const prompt = `${opts.description.slice(0, 400)}. ${look ? `Character look: ${look}. ` : ''}${minor}${PORTRAIT_STYLES[opts.style ?? 'anime']}, ${SAFE}`;
    return this.render(prompt, 'chat', `${opts.userId}/${opts.conversationId}/foto`, 832, 1040);
  }

  private async render(prompt: string, bucket: 'media' | 'chat', prefix: string, width: number, height: number): Promise<string> {
    const seed = Math.floor(Math.random() * 1_000_000_000);
    const url = `${this.opts.baseUrl}/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&nologo=true&safe=true&model=flux&seed=${seed}`;
    const doFetch = this.opts.fetch ?? fetch;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 100_000);
    let bytes: Uint8Array;
    try {
      const res = await doFetch(url, { signal: ctrl.signal, headers: { accept: 'image/*' } });
      if (!res.ok) throw new AppError(502, 'image_failed', res.status === 429 ? 'O gerador de imagens grátis está ocupado. Tente de novo em um minuto.' : 'Não foi possível gerar a imagem agora.');
      bytes = new Uint8Array(await res.arrayBuffer());
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError(504, 'image_timeout', 'O gerador de imagens demorou demais. Tente de novo.');
    } finally {
      clearTimeout(timer);
    }
    const mime = imageMime(bytes);
    if (!mime || bytes.byteLength < 2000 || bytes.byteLength > 8_000_000) throw new AppError(502, 'image_failed', 'O gerador devolveu uma imagem inválida. Tente de novo.');
    const path = `${prefix}-${Date.now().toString(36)}-${seed.toString(36)}.${mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'}`;
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
