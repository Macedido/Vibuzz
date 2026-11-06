export interface CharacterCard {
  id: string;
  kind: 'single' | 'group';
  name: string;
  tagline: string;
  description: string;
  greeting_preview: string;
  avatar_path: string | null;
  visibility: 'public' | 'unlisted' | 'private';
  maturity: 'general' | 'teen' | 'mature';
  category_slug: string | null;
  status: string;
  conversation_count: number;
  like_count: number;
  favorite_count: number;
  comment_count: number;
  rating: number | null;
  rating_count: number;
  published_at: string | null;
  created_at: string;
  creator_id: string;
  creator_username: string;
  creator_display_name: string;
  creator_avatar_path: string | null;
  tags: string[];
  member_count: number;
}

export interface ConversationItem {
  id: string;
  title: string;
  character_id: string;
  persona_id: string | null;
  is_favorite: boolean;
  is_archived: boolean;
  creativity: number;
  last_message_at: string;
  last_message_preview: string;
  active_leaf_id: string | null;
  character: { id: string; name: string; avatar_path: string | null; kind: string } | null;
}

export interface PathMessage {
  id: string;
  parent_id: string | null;
  depth: number;
  role: 'user' | 'assistant' | 'system';
  speaker_character_id: string | null;
  persona_id: string | null;
  audience_character_id: string | null;
  content: string;
  image_paths: string[];
  status: 'complete' | 'streaming' | 'error';
  is_pinned: boolean;
  created_at: string;
  sibling_ids: string[];
}

export interface Persona {
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
  is_default: boolean;
}

export interface MemoryRow {
  id: string;
  category: string;
  content: string;
  importance: number;
  status: string;
  holder_character_id: string | null;
  edited_by_user: boolean;
  created_at: string;
}

export function timeAgo(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'agora';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} d`;
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

export function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace('.0', '')} mil`;
  return `${(n / 1_000_000).toFixed(1).replace('.0', '')} mi`;
}
