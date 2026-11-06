import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { CharacterSheet, SceneState } from '@vibuzz/shared';
import { AppError } from './errors';

export type Db = SupabaseClient;

export function createAdminClient(url: string, serviceKey: string): Db {
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-client-info': 'vibuzz-api' } },
  });
}

/** Unwraps a Supabase response, throwing a 500 on error. */
export function must<T>(res: { data: T | null; error: { message: string; code?: string } | null }, what = 'db'): T {
  if (res.error) throw new AppError(500, 'db_error', `${what}: ${res.error.message}`);
  return res.data as T;
}

export interface UserRow {
  id: string;
  birthdate: string;
  allow_mature: boolean;
  role: 'user' | 'moderator' | 'admin';
  status: 'active' | 'suspended';
}

export interface CharacterRow {
  id: string;
  creator_id: string;
  kind: 'single' | 'group' | 'member';
  parent_group_id: string | null;
  name: string;
  tagline: string;
  description: string;
  avatar_path: string | null;
  visibility: 'public' | 'unlisted' | 'private';
  maturity: 'general' | 'teen' | 'mature';
  category_slug: string | null;
  current_version_id: string | null;
  current_version: number;
  status: 'active' | 'hidden' | 'removed';
}

export interface CharacterWithSheet extends CharacterRow {
  sheet: CharacterSheet;
}

export interface PersonaRow {
  id: string;
  owner_id: string;
  name: string;
  gender: string;
  age: string;
  biography: string;
  personality: string;
  appearance: string;
  history: string;
  extra: string;
  avatar_path: string | null;
}

export interface ConversationRow {
  id: string;
  user_id: string;
  character_id: string;
  persona_id: string | null;
  title: string;
  active_leaf_id: string | null;
  creativity: number;
  is_archived: boolean;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  parent_id: string | null;
  depth: number;
  role: 'user' | 'assistant' | 'system';
  speaker_character_id: string | null;
  persona_id: string | null;
  audience_character_id: string | null;
  content: string;
  image_paths: string[];
  image_analyses: ImageAnalysisRef[] | null;
  scene_state: SceneState | null;
  status: 'complete' | 'streaming' | 'error';
  is_pinned: boolean;
  deleted_at: string | null;
  created_at: string;
  memory_processed_at: string | null;
}

export interface ImageAnalysisRef {
  path: string;
  summary: string;
  kind: string;
}

export const MESSAGE_COLUMNS =
  'id, conversation_id, parent_id, depth, role, speaker_character_id, persona_id, audience_character_id, content, image_paths, image_analyses, scene_state, status, is_pinned, deleted_at, created_at, memory_processed_at';
