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
}

export type StreamEvent =
  | { type: 'user_message'; message: ApiMessage }
  | { type: 'speaker'; messageId: string; characterId: string | null; name: string }
  | { type: 'delta'; messageId: string; text: string }
  | { type: 'message_done'; message: ApiMessage }
  | { type: 'done' }
  | { type: 'error'; code: string; message: string };

export interface ProviderStatus {
  chat: boolean;
  embeddings: boolean;
  vision: boolean;
  moderation: 'provider' | 'llm' | 'none';
  missing: string[];
}
