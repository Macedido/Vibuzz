import { describe, expect, it } from 'vitest';
import { GeminiProvider, VERTEX_EXPRESS_BASE } from '../src/modules/ai/providers/gemini';
import { recentMessages } from '../src/modules/ai/service';

const ok = () =>
  new Response(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'oi' }] }, finishReason: 'STOP' }] })}\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });

describe('fallbacks for long chats and picky models', () => {
  it('retries Gemini without thinkingConfig when the request is rejected', async () => {
    const bodies: any[] = [];
    const f = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      bodies.push(body);
      return body.generationConfig.thinkingConfig ? new Response('{"error":{"code":400}}', { status: 400 }) : ok();
    }) as unknown as typeof fetch;
    const p = new GeminiProvider('AQ.k', [VERTEX_EXPRESS_BASE], f);
    const req = { system: { stable: 'x' }, messages: [{ role: 'user' as const, content: 'oi' }], maxTokens: 50 };
    let text = '';
    for await (const c of p.stream('gemini-flash-lite-latest', req)) if (c.type === 'text') text += c.text;
    expect(text).toBe('oi');
    expect(bodies).toHaveLength(2);
    // Remembers the working shape: next call goes straight without thinkingConfig.
    for await (const _ of p.stream('gemini-flash-lite-latest', req));
    expect(bodies).toHaveLength(3);
    expect(bodies[2].generationConfig.thinkingConfig).toBeUndefined();
  });

  it('keeps only the newest messages for free models', () => {
    const msgs = Array.from({ length: 10 }, (_, i) => ({ role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', content: String(i).repeat(1000) }));
    const out = recentMessages(msgs, 3500);
    expect(out.map((m) => m.content[0])).toEqual(['7', '8', '9']);
    expect(recentMessages(msgs.slice(0, 2), 10)).toHaveLength(2);
  });
});
