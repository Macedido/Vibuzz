import { characterSheetSchema } from '@vibuzz/shared';
import { describe, expect, it } from 'vitest';
import { extractJson } from '../src/lib/json';
import { policyViolations, slugifyTag } from '../src/modules/characters/service';
import { fillPlaceholders } from '../src/modules/conversations/service';
import { cleanReply } from '../src/modules/intelligence/engine';
import { currentScene } from '../src/modules/intelligence/scene';
import { backoffSeconds } from '../src/modules/jobs/worker';
import { cosine, extractionSchema, isDuplicate, jaccard, nextSummaryChunk, parseVector, resolveSources } from '../src/modules/memory/logic';
import { decide, normalizeProviderCategories } from '../src/modules/moderation/service';
import { pickSubject } from '../src/modules/vision/service';

describe('extractJson', () => {
  it('finds JSON inside prose and fences, respecting strings', () => {
    expect(extractJson('Claro! ```json\n{"a": "x}y", "b": [1,2]}\n``` pronto')).toEqual({ a: 'x}y', b: [1, 2] });
    expect(extractJson('resultado: {"ok": true} fim')).toEqual({ ok: true });
    expect(() => extractJson('sem json')).toThrow();
  });
});

describe('memory logic', () => {
  it('detects duplicates by embedding or word overlap', () => {
    expect(cosine([1, 0], [1, 0])).toBe(1);
    expect(isDuplicate({ content: 'a', embedding: [1, 0] }, { content: 'b', embedding: [0.99, 0.01] })).toBe(true);
    expect(isDuplicate({ content: 'a', embedding: [1, 0] }, { content: 'b', embedding: [0, 1] })).toBe(false);
    expect(isDuplicate({ content: 'Ana adora dias de chuva' }, { content: 'Ana adora dias de chuva!' })).toBe(true);
    expect(jaccard('Ana gosta de café', 'Pedro odeia futebol')).toBe(0);
    expect(isDuplicate({ content: 'x' }, { content: 'y', similarity: 0.95 })).toBe(true);
  });

  it('maps message numbers to ids and ignores hallucinated ones', () => {
    expect(resolveSources([1, 3, 3, 9], ['a', 'b', 'c'])).toEqual(['a', 'c']);
  });

  it('chooses summary chunks outside the recent window', () => {
    const path = Array.from({ length: 70 }, (_, i) => ({ id: String(i) }));
    const chunk = nextSummaryChunk(path, -1);
    expect(chunk[0].id).toBe('0');
    expect(chunk.length).toBe(40);
    expect(nextSummaryChunk(path, 39)).toEqual([]); // 40..45 → too small
    expect(nextSummaryChunk(path.slice(0, 30), -1)).toEqual([]);
  });

  it('validates extraction output', () => {
    const out = extractionSchema.parse({ create: [{ category: 'personal', content: 'Ana tem 20 anos', sources: [1] }] });
    expect(out.create[0]).toMatchObject({ importance: 0.5, holder: null });
    expect(() => extractionSchema.parse({ create: [{ category: 'inventada', content: 'x y z', sources: [] }] })).toThrow();
  });

  it('parses pgvector strings', () => {
    expect(parseVector('[1,2.5]')).toEqual([1, 2.5]);
    expect(parseVector(null)).toBeNull();
  });
});

describe('moderation policy', () => {
  it('is strict for public content and lenient for private fiction', () => {
    expect(decide(['violence_graphic'], 'chat').allowed).toBe(true);
    expect(decide(['violence_graphic'], 'profile').allowed).toBe(false);
    expect(decide(['sexual_minors'], 'chat').allowed).toBe(false);
    expect(decide(['sexual_explicit'], 'character').allowed).toBe(false);
    const crisis = decide(['self_harm_intent'], 'chat');
    expect(crisis).toMatchObject({ allowed: true, crisis: true });
  });
  it('normalises provider categories', () => {
    expect(normalizeProviderCategories(['sexual/minors', 'self-harm/intent', 'harassment'])).toEqual(['sexual_minors', 'self_harm_intent']);
  });
});

describe('character rules', () => {
  it('blocks minors in romance or mature ratings', () => {
    const teen = characterSheetSchema.parse({ name: 'Bia', age: '15' });
    expect(policyViolations({ sheet: teen, members: [], maturity: 'general', categorySlug: 'romance' })).toHaveLength(1);
    expect(policyViolations({ sheet: teen, members: [], maturity: 'mature' })).toHaveLength(1);
    const adult = characterSheetSchema.parse({ name: 'Kael', age: '20' });
    expect(policyViolations({ sheet: adult, members: [teen], maturity: 'general', categorySlug: 'romance' })).toHaveLength(1);
    expect(policyViolations({ sheet: adult, members: [], maturity: 'mature', categorySlug: 'romance' })).toEqual([]);
  });
  it('slugifies tags', () => {
    expect(slugifyTag('  Ficção Científica!! ')).toBe('ficcao-cientifica');
  });
});

describe('chat helpers', () => {
  it('fills {{user}} and {{char}}', () => {
    expect(fillPlaceholders('Oi {{user}}, sou {{ char }}.', 'Ana', 'Kael')).toBe('Oi Ana, sou Kael.');
  });
  it('strips speaker prefixes in group replies', () => {
    expect(cleanReply('Marina: Você sempre quer ficar em casa!', 'Marina')).toBe('Você sempre quer ficar em casa!');
    expect(cleanReply('[Marina]: oi', 'Marina')).toBe('oi');
    expect(cleanReply('Marina gosta disso.', 'Marina')).toBe('Marina gosta disso.');
  });
  it('finds the latest scene on a path', () => {
    const s = { location: 'a', present: [], objectives: [], items: [], dangers: [], situation: '', recentEvents: [] };
    expect(currentScene([{ scene_state: s }, { scene_state: null }])).toBe(s);
    expect(currentScene([{ scene_state: null }])).toBeNull();
  });
  it('backs off exponentially', () => {
    expect([1, 2, 3].map(backoffSeconds)).toEqual([10, 20, 40]);
    expect(backoffSeconds(20)).toBe(3600);
  });
});

describe('vision subject picking', () => {
  const analysis = {
    kind: 'multiple_characters' as const,
    summary: '',
    subjects: [
      { label: 'pessoa 1 (esquerda)', position: '', observable: { hair: 'ruivo', eyes: '', skin: '', build: '', clothing: '', accessories: '', expression: '', style: '', other: '' }, apparentAgeRange: '', notDeterminable: [] },
      { label: 'pessoa 2 (direita)', position: '', observable: { hair: 'preto', eyes: '', skin: '', build: '', clothing: '', accessories: '', expression: '', style: '', other: '' }, apparentAgeRange: '', notDeterminable: [] },
    ],
    scene: { setting: '', elements: [], mood: '', lighting: '' },
    artStyle: '',
    needsClarification: true,
    clarificationQuestion: '',
    safety: { flagged: false, reason: '', possibleMinor: false },
  };
  it('requires a choice when there are several people', () => {
    expect(pickSubject(analysis)).toBeNull();
    expect(pickSubject(analysis, 'pessoa 2 (direita)')?.observable.hair).toBe('preto');
    expect(pickSubject(analysis, 'pessoa 1')?.observable.hair).toBe('ruivo');
  });
});

describe('free AI support', async () => {
  const { ThinkFilter } = await import('../src/modules/ai/providers/openai');
  const { localScreen } = await import('../src/modules/moderation/service');
  const { bytesToBase64 } = await import('../src/lib/storage');
  const { AiService } = await import('../src/modules/ai/service');
  const { loadEnv } = await import('../src/config');

  it('removes <think> blocks even when split across chunks', () => {
    const f = new ThinkFilter();
    expect(['Olá <thi', 'nk>pensando...</th', 'ink> mundo', '!'].map((c) => f.push(c)).join('')).toBe('Olá  mundo!');
    const g = new ThinkFilter();
    expect(g.push('a < b')).toBe('a < b');
  });

  it('screens minors + sexual content and crisis signals locally', () => {
    expect(localScreen('ela tem 15 anos e quer sexo')).toEqual(['sexual_minors']);
    expect(localScreen('ela tem 25 anos e quer sexo')).toEqual([]);
    expect(localScreen('vamos explorar a caverna')).toEqual([]);
    expect(localScreen('sinceramente quero morrer')).toEqual(['self_harm_intent']);
  });

  it('encodes base64 without Buffer', () => {
    expect(bytesToBase64(new TextEncoder().encode('Vibuzz ✓'))).toBe(Buffer.from('Vibuzz ✓').toString('base64'));
  });

  it('uses keyless free models when no key is set, Gemini first when it is', () => {
    const base = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'x'.repeat(32) };
    const free = AiService.fromEnv(loadEnv(base), () => {});
    expect(free.chains.advanced[0]).toEqual({ provider: 'ovh', model: 'Meta-Llama-3_3-70B-Instruct' });
    expect(free.chains.advanced.at(-1)?.provider).toBe('pollinations');
    expect(free.hasPaidChat).toBe(false);
    expect(free.supportsInlineImages).toBe(false);
    expect(free.status().missing.join(' ')).toMatch(/GEMINI_API_KEY/);

    const gem = AiService.fromEnv(loadEnv({ ...base, GEMINI_API_KEY: 'k' }), () => {});
    expect(gem.chains.advanced[0]).toEqual({ provider: 'gemini', model: 'gemini-flash-latest' });
    expect(gem.chains.advanced[1].provider).toBe('ovh');
    expect(gem.hasPaidChat).toBe(true);

    const off = AiService.fromEnv(loadEnv({ ...base, FREE_AI: 'false' }), () => {});
    expect(off.status().chat).toBe(false);
  });
});

describe('portraits (free image model)', () => {
  it('detects real image bytes', async () => {
    const { imageMime } = await import('../src/modules/images/service');
    expect(imageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(imageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('image/png');
    expect(imageMime(new TextEncoder().encode('{"error":"busy"}'))).toBeNull();
  });

  it('builds a safe prompt, uploads the image and returns its path', async () => {
    const { ImageService } = await import('../src/modules/images/service');
    const { characterSheetSchema } = await import('@vibuzz/shared');
    const uploads: { path: string; type?: string }[] = [];
    const db = { storage: { from: () => ({ upload: async (path: string, _b: Uint8Array, o: { contentType: string }) => (uploads.push({ path, type: o.contentType }), { error: null }) }) } };
    const ai = { complete: async () => ({ text: '"A fox girl with white and orange hair, purple eyes, Christmas classroom"' }) };
    let requested = '';
    const jpeg = new Uint8Array(5000);
    jpeg.set([0xff, 0xd8, 0xff]);
    const fetchFn = (async (url: string) => ((requested = url), new Response(jpeg, { status: 200 }))) as unknown as typeof fetch;
    const svc = new ImageService(ai as never, db as never, { baseUrl: 'https://img.test', fetch: fetchFn });
    const sheet = characterSheetSchema.parse({ name: 'Lolbit', age: '15' });
    const out = await svc.generatePortrait(sheet, 'anime', 'user-1');
    expect(out.path).toMatch(/^user-1\/characters\/ai-.+\.jpg$/);
    expect(uploads[0]).toEqual({ path: out.path, type: 'image/jpeg' });
    const prompt = decodeURIComponent(requested.split('/prompt/')[1].split('?')[0]);
    expect(prompt).toContain('A fox girl with white and orange hair');
    expect(prompt).toContain('fully clothed');
    expect(requested).toContain('safe=true');
  });

  it('refuses non-image answers from the generator', async () => {
    const { ImageService } = await import('../src/modules/images/service');
    const { characterSheetSchema } = await import('@vibuzz/shared');
    const fetchFn = (async () => new Response('{"error":"queue full"}', { status: 200 })) as unknown as typeof fetch;
    const svc = new ImageService({ complete: async () => ({ text: 'x' }) } as never, {} as never, { baseUrl: 'https://img.test', fetch: fetchFn });
    await expect(svc.generatePortrait(characterSheetSchema.parse({ name: 'X' }), 'anime', 'u')).rejects.toThrow(/inválida/);
  });
});
