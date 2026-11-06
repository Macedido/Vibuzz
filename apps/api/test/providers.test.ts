import { describe, expect, it, vi } from 'vitest';
import { ProviderError } from '../src/lib/errors';
import { SseParser } from '../src/lib/sse';
import { AnthropicProvider } from '../src/modules/ai/providers/anthropic';
import { OpenAICompatibleProvider } from '../src/modules/ai/providers/openai';
import type { ChatRequest, StreamChunk } from '../src/modules/ai/types';

function sseResponse(events: string[], status = 200) {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder();
      // Split awkwardly to exercise buffering.
      for (const e of events) {
        const s = e + '\n\n';
        c.enqueue(enc.encode(s.slice(0, 7)));
        c.enqueue(enc.encode(s.slice(7)));
      }
      c.close();
    },
  });
  return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } });
}

const req: ChatRequest = {
  system: { stable: 'rules', dynamic: 'ctx' },
  messages: [{ role: 'user', content: 'oi' }],
  maxTokens: 100,
  temperature: 0.7,
  effort: 'low',
};

async function collect(it: AsyncIterable<StreamChunk>) {
  const out: StreamChunk[] = [];
  for await (const c of it) out.push(c);
  return out;
}

describe('SseParser', () => {
  it('handles split chunks, comments and multi-line data', () => {
    const p = new SseParser();
    expect(p.push('event: a\nda')).toEqual([]);
    expect(p.push('ta: {"x":1}\n\n: ping\n\ndata: l1\ndata: l2\n\n')).toEqual([
      { event: 'a', data: '{"x":1}' },
      { event: null, data: 'l1\nl2' },
    ]);
  });
});

describe('AnthropicProvider', () => {
  it('streams only text deltas and reports usage', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10,"cache_read_input_tokens":5,"output_tokens":1}}}',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"hmm"}}',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Olá"}}',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":", Ana."}}',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7}}',
        'event: message_stop\ndata: {"type":"message_stop"}',
      ]),
    );
    const p = new AnthropicProvider('key', 'https://api.anthropic.com', fetchMock as unknown as typeof fetch);
    const chunks = await collect(p.stream('claude-sonnet-5-5', req));
    expect(chunks.filter((c) => c.type === 'text').map((c) => (c as { text: string }).text).join('')).toBe('Olá, Ana.');
    expect(chunks.at(-1)).toMatchObject({ type: 'end', inputTokens: 15, outputTokens: 7, stopReason: 'end_turn' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(body.output_config).toEqual({ effort: 'low' });
    expect(body.temperature).toBe(0.7);
  });

  it('retries without temperature when the model rejects it, and remembers', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"error":{"message":"temperature is not supported"}}', { status: 400 }))
      .mockResolvedValue(sseResponse(['data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}']));
    const p = new AnthropicProvider('key', 'https://x', fetchMock as unknown as typeof fetch);
    await collect(p.stream('m', req));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).temperature).toBeUndefined();
    await collect(p.stream('m', req));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).temperature).toBeUndefined();
  });

  it('marks 5xx as retryable and 401 as not', async () => {
    const p500 = new AnthropicProvider('k', 'https://x', vi.fn().mockResolvedValue(new Response('boom', { status: 529 })) as unknown as typeof fetch);
    await expect(collect(p500.stream('m', req))).rejects.toMatchObject({ retryable: true });
    const p401 = new AnthropicProvider('k', 'https://x', vi.fn().mockResolvedValue(new Response('no', { status: 401 })) as unknown as typeof fetch);
    const err = await collect(p401.stream('m', req)).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.retryable).toBe(false);
  });

  it('sends images as base64 blocks', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([]));
    const p = new AnthropicProvider('k', 'https://x', fetchMock as unknown as typeof fetch);
    await collect(
      p.stream('m', { ...req, messages: [{ role: 'user', content: [{ type: 'text', text: 'olha' }, { type: 'image', base64: 'AAA', mimeType: 'image/png' }] }] }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[0].content[1]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } });
  });
});

describe('OpenAICompatibleProvider', () => {
  it('streams chat completions with usage', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"Oi"}}]}',
        'data: {"choices":[{"delta":{"content":"!"},"finish_reason":"stop"}]}',
        'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":3}}',
        'data: [DONE]',
      ]),
    );
    const p = new OpenAICompatibleProvider('openai', 'k', 'https://api.openai.com/v1', { official: true }, fetchMock as unknown as typeof fetch);
    const chunks = await collect(p.stream('gpt', req));
    expect(chunks.map((c) => (c.type === 'text' ? c.text : '')).join('')).toBe('Oi!');
    expect(chunks.at(-1)).toMatchObject({ type: 'end', inputTokens: 12, outputTokens: 3, stopReason: 'stop' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.max_completion_tokens).toBe(100);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'rules\n\nctx' });
  });

  it('parses embeddings in index order and checks dimensions', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }], usage: { prompt_tokens: 4 } }),
    );
    const p = new OpenAICompatibleProvider('openai', 'k', 'https://x', { official: true }, fetchMock as unknown as typeof fetch);
    expect(await p.embed('e', ['a', 'b'], 2)).toEqual({ vectors: [[1, 0], [0, 1]], inputTokens: 4 });
    await expect(p.embed('e', ['a', 'b'], 3)).rejects.toThrow(/expected 3/);
  });
});
