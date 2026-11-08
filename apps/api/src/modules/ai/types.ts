export type Tier = 'fast' | 'advanced' | 'specialized';
export type Capability = Tier | 'vision' | 'embedding';

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; base64: string; mimeType: string };

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string | ContentPart[];
}

export interface ChatRequest {
  /** Stable part first (cacheable), then the dynamic part. */
  system: { stable: string; dynamic?: string };
  messages: ChatMessage[];
  maxTokens: number;
  /** 0..1, mapped per provider. Ignored where unsupported. */
  temperature?: number;
  /** Ask for a JSON object answer. */
  json?: boolean;
  /** Reasoning effort hint (providers that support it). */
  effort?: 'low' | 'medium' | 'high';
  signal?: AbortSignal;
  /**
   * If the current model has not produced its first token after this many ms, the
   * next model in the chain starts in parallel and whichever answers first wins.
   * Defaults: 5 s for streamed text, 12 s for JSON tasks. 0 disables hedging.
   */
  hedgeMs?: number;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
}

export interface ChatResult extends Usage {
  text: string;
  provider: string;
  model: string;
  stopReason: string | null;
}

export type StreamChunk = { type: 'text'; text: string } | ({ type: 'end'; stopReason: string | null } & Usage);

export interface EmbedResult {
  vectors: number[][];
  inputTokens: number;
}

export interface ModerationResult {
  flagged: boolean;
  categories: string[];
  scores: Record<string, number>;
}

export interface ChatProvider {
  readonly name: string;
  stream(model: string, req: ChatRequest): AsyncIterable<StreamChunk>;
  embed?(model: string, input: string[], dimensions: number): Promise<EmbedResult>;
  moderate?(input: { text?: string; imageBase64?: { data: string; mimeType: string } }): Promise<ModerationResult>;
}

export interface ModelRef {
  provider: string;
  model: string;
}
