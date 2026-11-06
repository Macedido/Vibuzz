/**
 * Minimal Server-Sent Events parser for provider streams.
 * Feeds raw text chunks, yields {event, data} records.
 */
export interface SseRecord {
  event: string | null;
  data: string;
}

export class SseParser {
  private buffer = '';

  push(chunk: string): SseRecord[] {
    this.buffer += chunk.replace(/\r\n/g, '\n');
    const out: SseRecord[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf('\n\n')) !== -1) {
      const block = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      let event: string | null = null;
      const data: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith(':')) continue;
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (data.length) out.push({ event, data: data.join('\n') });
    }
    return out;
  }
}

export async function* readSse(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<SseRecord> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      for (const rec of parser.push(decoder.decode(value, { stream: true }))) yield rec;
    }
    for (const rec of parser.push('\n\n')) yield rec;
  } finally {
    reader.releaseLock();
  }
}
