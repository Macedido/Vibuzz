import { describe, expect, it } from 'vitest';
import { GEMINI_API_BASE, GeminiProvider, geminiBasesFor, VERTEX_EXPRESS_BASE } from '../src/modules/ai/providers/gemini';

const sse = (events: unknown[]) =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } });

const req = { system: { stable: 'Você é Lyra.' }, messages: [{ role: 'user' as const, content: 'oi' }], maxTokens: 100 };

async function collect(p: GeminiProvider, model = 'gemini-flash-latest') {
  let text = '';
  let end: any = null;
  for await (const c of p.stream(model, req)) {
    if (c.type === 'text') text += c.text;
    else end = c;
  }
  return { text, end };
}

describe('Gemini native provider', () => {
  it('picks Vertex express for AQ keys and the Gemini API for AIza keys', () => {
    expect(geminiBasesFor('AQ.abc')[0]).toBe(VERTEX_EXPRESS_BASE);
    expect(geminiBasesFor('AIzaXYZ')[0]).toBe(GEMINI_API_BASE);
  });

  it('streams text, maps model ids for Vertex and reads usage', async () => {
    const calls: string[] = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push(url);
      expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('AQ.k');
      const body = JSON.parse(String(init.body));
      expect(body.systemInstruction.parts[0].text).toContain('Lyra');
      expect(body.contents[0]).toEqual({ role: 'user', parts: [{ text: 'oi' }] });
      return sse([
        { candidates: [{ content: { parts: [{ text: 'Olá, ' }] } }] },
        { candidates: [{ content: { parts: [{ text: 'viajante.' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4 } },
      ]);
    }) as unknown as typeof fetch;
    const out = await collect(new GeminiProvider('AQ.k', geminiBasesFor('AQ.k'), f));
    expect(out.text).toBe('Olá, viajante.');
    expect(out.end).toMatchObject({ stopReason: 'stop', inputTokens: 12, outputTokens: 4 });
    expect(calls[0]).toBe(`${VERTEX_EXPRESS_BASE}/gemini-2.5-flash:streamGenerateContent?alt=sse`);
  });

  it('tries the other Google base when the key belongs to it, then remembers', async () => {
    const calls: string[] = [];
    const f = (async (url: string) => {
      calls.push(url);
      return url.startsWith(VERTEX_EXPRESS_BASE) ? new Response('{"error":"API key not valid"}', { status: 403 }) : sse([{ candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] }]);
    }) as unknown as typeof fetch;
    const p = new GeminiProvider('AQ.k', geminiBasesFor('AQ.k'), f);
    expect((await collect(p)).text).toBe('ok');
    expect((await collect(p)).text).toBe('ok');
    expect(calls.map((u) => u.split('/models/')[0])).toEqual([VERTEX_EXPRESS_BASE.split('/models')[0], GEMINI_API_BASE.split('/models')[0], GEMINI_API_BASE.split('/models')[0]]);
  });

  it('turns blocked or empty answers into a retryable error (next model takes over)', async () => {
    const f = (async () => sse([{ candidates: [{ finishReason: 'SAFETY' }] }])) as unknown as typeof fetch;
    await expect(collect(new GeminiProvider('AIza', geminiBasesFor('AIza'), f))).rejects.toMatchObject({ retryable: true });
  });
});
