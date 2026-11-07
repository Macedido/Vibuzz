import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { NotConfiguredError, ProviderError } from '../src/lib/errors';
import { AiService, chooseChatTier, creativityToTemperature, parseChain } from '../src/modules/ai/service';
import type { ChatProvider, ChatRequest, StreamChunk } from '../src/modules/ai/types';

function fake(name: string, behaviour: (model: string) => AsyncGenerator<StreamChunk>): ChatProvider {
  return { name, stream: (model: string) => behaviour(model) };
}
async function* ok(text: string): AsyncGenerator<StreamChunk> {
  yield { type: 'text', text };
  yield { type: 'end', stopReason: 'end_turn', inputTokens: 1000, outputTokens: 500 };
}
async function* fail(retryable: boolean, afterText = false): AsyncGenerator<StreamChunk> {
  if (afterText) yield { type: 'text', text: 'parc' };
  throw new ProviderError('x', retryable ? 503 : 400, 'nope', retryable);
}

const req: ChatRequest = { system: { stable: 's' }, messages: [{ role: 'user', content: 'hi' }], maxTokens: 50 };
const meta = { kind: 'test', userId: 'u' };

describe('parseChain', () => {
  it('parses fallback chains', () => {
    expect(parseChain('anthropic:claude-sonnet-5-5, openai:gpt-x')).toEqual([
      { provider: 'anthropic', model: 'claude-sonnet-5-5' },
      { provider: 'openai', model: 'gpt-x' },
    ]);
    expect(() => parseChain('bad')).toThrow();
  });
});

describe('AiService', () => {
  it('falls back to the next model when the first fails before output', async () => {
    const sink = vi.fn();
    const ai = new AiService(
      new Map([
        ['a', fake('a', () => fail(true))],
        ['b', fake('b', () => ok('resposta'))],
      ]),
      { advanced: [{ provider: 'a', model: 'm1' }, { provider: 'b', model: 'm2' }] },
      sink,
      { 'b:m2': { input: 2, output: 10 } },
    );
    const deltas: string[] = [];
    const res = await ai.stream('advanced', req, meta, (t) => deltas.push(t));
    expect(res).toMatchObject({ text: 'resposta', provider: 'b', model: 'm2' });
    expect(deltas).toEqual(['resposta']);
    expect(sink).toHaveBeenCalledTimes(2);
    expect(sink.mock.calls[0][0]).toMatchObject({ provider: 'a', success: false });
    expect(sink.mock.calls[1][0].costUsd).toBeCloseTo((1000 * 2 + 500 * 10) / 1e6);
  });

  it('does not fall back after text was streamed', async () => {
    const ai = new AiService(
      new Map([
        ['a', fake('a', () => fail(true, true))],
        ['b', fake('b', () => ok('x'))],
      ]),
      { advanced: [{ provider: 'a', model: 'm1' }, { provider: 'b', model: 'm2' }] },
      () => {},
    );
    await expect(ai.stream('advanced', req, meta, () => {})).rejects.toBeInstanceOf(ProviderError);
  });

  it('falls back on any error before the first token (e.g. a model rejecting the request)', async () => {
    const second = vi.fn(() => ok('x'));
    const ai = new AiService(new Map([['a', fake('a', () => fail(false))], ['b', fake('b', second)]]), { advanced: [{ provider: 'a', model: 'm' }, { provider: 'b', model: 'm' }] }, () => {});
    expect((await ai.complete('advanced', req, meta)).text).toBe('x');
    expect(second).toHaveBeenCalled();
  });

  it('surfaces the last error when every model fails', async () => {
    const ai = new AiService(new Map([['a', fake('a', () => fail(true))], ['b', fake('b', () => fail(false))]]), { advanced: [{ provider: 'a', model: 'm' }, { provider: 'b', model: 'm' }] }, () => {});
    await expect(ai.complete('advanced', req, meta)).rejects.toBeInstanceOf(ProviderError);
  });

  it('reuses neighbouring tiers and reports missing config', () => {
    const ai = new AiService(new Map([['a', fake('a', () => ok(''))]]), { advanced: [{ provider: 'a', model: 'm' }] }, () => {});
    expect(ai.chains.fast).toEqual(ai.chains.advanced);
    expect(ai.chains.specialized).toEqual(ai.chains.advanced);
    const st = ai.status();
    expect(st.chat).toBe(true);
    expect(st.embeddings).toBe(false);
    expect(st.missing.join(' ')).toMatch(/Embeddings/);
  });

  it('ignores chains whose provider has no key', async () => {
    const ai = new AiService(new Map(), { advanced: [{ provider: 'anthropic', model: 'x' }] }, () => {});
    await expect(ai.complete('advanced', req, meta)).rejects.toBeInstanceOf(NotConfiguredError);
    expect(await ai.embed(['a'], meta)).toBeNull();
  });

  it('repairs invalid JSON once', async () => {
    let call = 0;
    const ai = new AiService(
      new Map([['a', fake('a', () => (call++ === 0 ? ok('não é json') : ok('{"n": 3}')))]]),
      { advanced: [{ provider: 'a', model: 'm' }] },
      () => {},
    );
    expect(await ai.completeJson('advanced', req, z.object({ n: z.number() }), meta)).toEqual({ n: 3 });
  });
});

describe('tier selection and creativity', () => {
  it('chooses levels by complexity', () => {
    expect(chooseChatTier({ isGroup: false, userChars: 50, hasImages: false })).toBe('advanced');
    expect(chooseChatTier({ isGroup: true, speakers: 3, userChars: 50, hasImages: false })).toBe('specialized');
    expect(chooseChatTier({ isGroup: false, userChars: 4000, hasImages: false })).toBe('specialized');
  });
  it('maps creativity to temperature', () => {
    expect(creativityToTemperature(0)).toBe(0.3);
    expect(creativityToTemperature(1)).toBe(1.05);
    expect(creativityToTemperature(5)).toBe(1.05);
  });
});
