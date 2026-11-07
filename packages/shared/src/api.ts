import { z } from 'zod';
import { characterSheetSchema, MATURITY, personaSchema, VISIBILITIES } from './sheet';

/* ---------- Characters ---------- */

export const groupMemberInputSchema = z.object({
  /** Existing member character id when editing. */
  id: z.string().uuid().optional(),
  sheet: characterSheetSchema,
  avatarPath: z.string().max(400).nullable().optional(),
});
export type GroupMemberInput = z.infer<typeof groupMemberInputSchema>;

export const characterUpsertSchema = z.object({
  kind: z.enum(['single', 'group']).default('single'),
  sheet: characterSheetSchema,
  visibility: z.enum(VISIBILITIES).default('private'),
  maturity: z.enum(MATURITY).default('general'),
  categorySlug: z.string().max(60).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(12).default([]),
  avatarPath: z.string().max(400).nullable().optional(),
  imagePaths: z.array(z.string().max(400)).max(8).default([]),
  members: z.array(groupMemberInputSchema).max(8).default([]),
  versionNote: z.string().max(200).optional(),
});
export type CharacterUpsert = z.input<typeof characterUpsertSchema>;

export const creatorGenerateSchema = z.object({
  idea: z.string().trim().min(3).max(4000),
  imagePaths: z.array(z.string().max(400)).max(4).default([]),
  /** Which subject of a multi-person image represents the character. */
  subjectLabel: z.string().max(120).optional(),
  kind: z.enum(['single', 'group']).default('single'),
});
export type CreatorGenerateInput = z.input<typeof creatorGenerateSchema>;

export const regenerateFieldSchema = z.object({
  sheet: characterSheetSchema,
  field: z.string().max(40),
  guidance: z.string().max(1000).optional(),
});

export const PORTRAIT_STYLE_IDS = ['anime', 'realista', '3d', 'fantasia'] as const;
export const portraitSchema = z.object({
  sheet: characterSheetSchema,
  style: z.enum(PORTRAIT_STYLE_IDS).default('anime'),
});

export const visionAnalyzeSchema = z.object({
  path: z.string().max(400),
  bucket: z.enum(['media', 'chat']).default('media'),
});

/* ---------- Conversations ---------- */

export const createConversationSchema = z.object({
  characterId: z.string().uuid(),
  personaId: z.string().uuid().nullable().optional(),
});

export const sendMessageSchema = z.object({
  content: z.string().max(8000).default(''),
  imagePaths: z.array(z.string().max(400)).max(4).default([]),
  /** Parent message to attach to; defaults to the active leaf. */
  parentId: z.string().uuid().nullable().optional(),
  /** Group chats: talk privately to one member. */
  privateToCharacterId: z.string().uuid().nullable().optional(),
});
export type SendMessageInput = z.input<typeof sendMessageSchema>;

export const regenerateSchema = z.object({
  messageId: z.string().uuid(),
});

export const editMessageSchema = z.object({
  content: z.string().min(1).max(8000),
  /** branch = keep original as separate branch; replace = hide original subtree. */
  mode: z.enum(['branch', 'replace']).default('branch'),
  regenerate: z.boolean().default(true),
});

export const switchBranchSchema = z.object({
  messageId: z.string().uuid(),
});

export const conversationSettingsSchema = z.object({
  personaId: z.string().uuid().nullable().optional(),
  creativity: z.number().min(0).max(1).optional(),
});

/* ---------- Social / profile ---------- */

export const profileUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(50).optional(),
  username: z
    .string()
    .trim()
    .regex(/^[a-z0-9_.]{3,24}$/)
    .optional(),
  bio: z.string().trim().max(400).optional(),
  avatarPath: z.string().max(400).nullable().optional(),
  allowMature: z.boolean().optional(),
});

export const commentSchema = z.object({
  characterId: z.string().uuid(),
  body: z.string().trim().min(1).max(1000),
  parentId: z.string().uuid().nullable().optional(),
});

export const memoryUpdateSchema = z.object({
  content: z.string().trim().min(1).max(1000),
});

export const personaUpsertSchema = personaSchema.extend({
  avatarPath: z.string().max(400).nullable().optional(),
});

/* ---------- Streaming events (SSE) ---------- */

export interface ApiMessage {
  id: string;
  conversation_id: string;
  parent_id: string | null;
  role: 'user' | 'assistant' | 'system';
  speaker_character_id: string | null;
  content: string;
  image_paths: string[];
  status: 'complete' | 'streaming' | 'error';
  is_pinned: boolean;
  created_at: string;
  emotion?: Emotion | null;
  is_spontaneous?: boolean;
}

/** Emotions a reply can show (set by the scene tracker after each turn). */
export const EMOTIONS = ['feliz', 'animado', 'carinho', 'surpresa', 'vergonha', 'triste', 'raiva', 'medo', 'ciume', 'preocupado', 'tedio', 'neutro'] as const;
export type Emotion = (typeof EMOTIONS)[number];
export const EMOTION_LABELS: Record<Emotion, { emoji: string; label: string }> = {
  feliz: { emoji: '😊', label: 'feliz' },
  animado: { emoji: '🤩', label: 'animado' },
  carinho: { emoji: '🥰', label: 'carinhoso' },
  surpresa: { emoji: '😮', label: 'surpreso' },
  vergonha: { emoji: '😳', label: 'com vergonha' },
  triste: { emoji: '😢', label: 'triste' },
  raiva: { emoji: '😠', label: 'bravo' },
  medo: { emoji: '😨', label: 'com medo' },
  ciume: { emoji: '😒', label: 'com ciúme' },
  preocupado: { emoji: '😟', label: 'preocupado' },
  tedio: { emoji: '😑', label: 'entediado' },
  neutro: { emoji: '🙂', label: 'tranquilo' },
};

/** Relationship meters (0–100) toward the user. */
export const METERS = [
  { key: 'amizade', label: 'Amizade' },
  { key: 'confianca', label: 'Confiança' },
  { key: 'intimidade', label: 'Intimidade' },
  { key: 'rivalidade', label: 'Rivalidade' },
] as const;
export type MeterKey = (typeof METERS)[number]['key'];

/** Limits by plan. The free plan stays fully usable. */
export const PLAN_LIMITS = {
  free: { imagesPerDay: 12, proactivePerDay: { sometimes: 2, often: 6 }, privateCharacters: 20, memoryItems: 12 },
  premium: { imagesPerDay: 80, proactivePerDay: { sometimes: 3, often: 16 }, privateCharacters: 200, memoryItems: 24 },
} as const;
export type Plan = keyof typeof PLAN_LIMITS;

export const PROACTIVE_MODES = ['off', 'sometimes', 'often'] as const;
export type ProactiveMode = (typeof PROACTIVE_MODES)[number];

export const translateSchema = z.object({ lang: z.string().trim().min(2).max(40) });
export const pushSubscribeSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }),
});

export type StreamEvent =
  | { type: 'user_message'; message: ApiMessage }
  | { type: 'speaker'; messageId: string; characterId: string | null; name: string }
  | { type: 'delta'; messageId: string; text: string }
  | { type: 'message_done'; message: ApiMessage }
  | { type: 'image'; messageId: string; status: 'pending' | 'failed' }
  | { type: 'done' }
  | { type: 'error'; code: string; message: string };

export interface ProviderStatus {
  chat: boolean;
  embeddings: boolean;
  vision: boolean;
  moderation: 'provider' | 'llm' | 'none';
  missing: string[];
}
