-- Vibuzz — core schema
set search_path = public, extensions;

-------------------------------------------------------------------------------
-- Accounts
-------------------------------------------------------------------------------

-- Private account data. One row per auth user (created by trigger on signup).
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  birthdate date not null,
  allow_mature boolean not null default false,
  role text not null default 'user' check (role in ('user', 'moderator', 'admin')),
  status text not null default 'active' check (status in ('active', 'suspended')),
  -- Future "characters with their own life" feature: off unless the user opts in.
  spontaneous_messages boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Public profile.
create table public.user_profiles (
  id uuid primary key references public.users (id) on delete cascade,
  username text not null check (username ~ '^[a-z0-9_.]{3,24}$'),
  display_name text not null check (char_length(display_name) between 1 and 50),
  bio text not null default '' check (char_length(bio) <= 400),
  avatar_path text,
  follower_count integer not null default 0,
  following_count integer not null default 0,
  character_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index user_profiles_username_key on public.user_profiles (lower(username));
create index user_profiles_username_trgm on public.user_profiles using gin (username extensions.gin_trgm_ops);

create table public.blocks (
  blocker_id uuid not null references public.users (id) on delete cascade,
  blocked_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index blocks_blocked_idx on public.blocks (blocked_id);

-------------------------------------------------------------------------------
-- Personas (the user's fictional identities)
-------------------------------------------------------------------------------

create table public.personas (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  gender text not null default '' check (char_length(gender) <= 120),
  age text not null default '' check (char_length(age) <= 120),
  biography text not null default '' check (char_length(biography) <= 6000),
  personality text not null default '' check (char_length(personality) <= 1200),
  appearance text not null default '' check (char_length(appearance) <= 1200),
  history text not null default '' check (char_length(history) <= 6000),
  extra text not null default '' check (char_length(extra) <= 1200),
  avatar_path text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index personas_owner_idx on public.personas (owner_id);
create unique index personas_one_default on public.personas (owner_id) where is_default;

-------------------------------------------------------------------------------
-- Catalog
-------------------------------------------------------------------------------

create table public.categories (
  slug text primary key,
  name text not null,
  position integer not null default 0,
  mature boolean not null default false
);

insert into public.categories (slug, name, position) values
  ('romance', 'Romance', 1),
  ('terror', 'Terror', 2),
  ('suspense', 'Suspense', 3),
  ('fantasia', 'Fantasia', 4),
  ('ficcao-cientifica', 'Ficção científica', 5),
  ('anime', 'Anime', 6),
  ('vida-cotidiana', 'Vida cotidiana', 7),
  ('aventura', 'Aventura', 8),
  ('drama', 'Drama', 9),
  ('comedia', 'Comédia', 10),
  ('rpg', 'RPG', 11),
  ('misterio', 'Mistério', 12),
  ('realistas', 'Personagens realistas', 13),
  ('universos', 'Universos fictícios', 14);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{1,30}$'),
  name text not null check (char_length(name) between 1 and 30),
  use_count integer not null default 0,
  created_at timestamptz not null default now()
);

-------------------------------------------------------------------------------
-- Characters
-------------------------------------------------------------------------------

create table public.characters (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.users (id) on delete cascade,
  -- single = normal character, group = multi-member character, member = a member of a group
  kind text not null default 'single' check (kind in ('single', 'group', 'member')),
  parent_group_id uuid references public.characters (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  tagline text not null default '' check (char_length(tagline) <= 160),
  description text not null default '' check (char_length(description) <= 800),
  greeting_preview text not null default '' check (char_length(greeting_preview) <= 400),
  avatar_path text,
  visibility text not null default 'private' check (visibility in ('public', 'unlisted', 'private')),
  maturity text not null default 'general' check (maturity in ('general', 'teen', 'mature')),
  category_slug text references public.categories (slug) on delete set null,
  current_version_id uuid,
  current_version integer not null default 0,
  status text not null default 'active' check (status in ('active', 'hidden', 'removed')),
  conversation_count integer not null default 0,
  like_count integer not null default 0,
  favorite_count integer not null default 0,
  comment_count integer not null default 0,
  rating_sum integer not null default 0,
  rating_count integer not null default 0,
  search_text text not null default '',
  search_document tsvector,
  embedding extensions.vector(1536),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'member') = (parent_group_id is not null))
);
create index characters_creator_idx on public.characters (creator_id);
create index characters_parent_idx on public.characters (parent_group_id) where parent_group_id is not null;
create index characters_public_idx on public.characters (published_at desc) where visibility = 'public' and status = 'active' and kind <> 'member';
create index characters_category_idx on public.characters (category_slug);
create index characters_search_idx on public.characters using gin (search_document);
create index characters_name_trgm on public.characters using gin (name extensions.gin_trgm_ops);
create index characters_embedding_idx on public.characters using hnsw (embedding extensions.vector_cosine_ops);

-- Immutable history of every sheet. Editing creates a new version; nothing is lost.
create table public.character_versions (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters (id) on delete cascade,
  version integer not null,
  sheet jsonb not null,
  note text not null default '' check (char_length(note) <= 200),
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (character_id, version)
);

alter table public.characters
  add constraint characters_current_version_fk
  foreign key (current_version_id) references public.character_versions (id) on delete set null;

create table public.character_images (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters (id) on delete cascade,
  path text not null,
  kind text not null default 'gallery' check (kind in ('avatar', 'reference', 'gallery')),
  analysis jsonb,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index character_images_character_idx on public.character_images (character_id, position);

create table public.character_tags (
  character_id uuid not null references public.characters (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  primary key (character_id, tag_id)
);
create index character_tags_tag_idx on public.character_tags (tag_id);

-- Group ("multiple members") characters.
create table public.character_groups (
  character_id uuid primary key references public.characters (id) on delete cascade,
  shared_memory boolean not null default true,
  max_speakers_per_turn integer not null default 3 check (max_speakers_per_turn between 1 and 8),
  created_at timestamptz not null default now()
);

create table public.group_members (
  group_id uuid not null references public.character_groups (character_id) on delete cascade,
  member_id uuid not null references public.characters (id) on delete cascade,
  position integer not null default 0,
  primary key (group_id, member_id)
);
create index group_members_member_idx on public.group_members (member_id);

-------------------------------------------------------------------------------
-- Conversations and messages (messages form a tree → branches)
-------------------------------------------------------------------------------

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  character_id uuid not null references public.characters (id) on delete cascade,
  persona_id uuid references public.personas (id) on delete set null,
  title text not null default '' check (char_length(title) <= 120),
  active_leaf_id uuid,
  is_favorite boolean not null default false,
  is_archived boolean not null default false,
  creativity real not null default 0.7 check (creativity between 0 and 1),
  last_message_at timestamptz not null default now(),
  last_message_preview text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index conversations_user_idx on public.conversations (user_id, last_message_at desc);
create index conversations_character_idx on public.conversations (character_id, created_at desc);

-- Which characters take part (group members, or the single character).
create table public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  character_id uuid not null references public.characters (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, character_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  parent_id uuid references public.messages (id) on delete cascade,
  depth integer not null default 0,
  role text not null check (role in ('user', 'assistant', 'system')),
  speaker_character_id uuid references public.characters (id) on delete set null,
  persona_id uuid references public.personas (id) on delete set null,
  content text not null default '' check (char_length(content) <= 32000),
  image_paths text[] not null default '{}',
  image_analyses jsonb,
  -- Narrative snapshot after this message (location, objects, objectives...).
  scene_state jsonb,
  status text not null default 'complete' check (status in ('complete', 'streaming', 'error')),
  is_pinned boolean not null default false,
  edited_from_id uuid references public.messages (id) on delete set null,
  -- Removed from the active history (UI and AI). Content kept until purge.
  deleted_at timestamptz,
  hidden_reason text check (hidden_reason in ('deleted', 'replaced')),
  -- Content physically erased.
  purged_at timestamptz,
  model text,
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now()
);
create index messages_conversation_idx on public.messages (conversation_id, created_at);
create index messages_parent_idx on public.messages (parent_id);
create index messages_pinned_idx on public.messages (conversation_id) where is_pinned and deleted_at is null;
create index messages_search_idx on public.messages using gin (to_tsvector('simple', content));

alter table public.conversations
  add constraint conversations_active_leaf_fk
  foreign key (active_leaf_id) references public.messages (id) on delete set null;

create table public.message_branches (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  fork_parent_id uuid references public.messages (id) on delete cascade,
  first_message_id uuid not null references public.messages (id) on delete cascade,
  label text not null default '' check (char_length(label) <= 80),
  created_at timestamptz not null default now()
);
create index message_branches_conversation_idx on public.message_branches (conversation_id);

-------------------------------------------------------------------------------
-- Memory
-------------------------------------------------------------------------------

create table public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  character_id uuid not null references public.characters (id) on delete cascade,
  -- Group member that knows this memory. NULL = everyone in the conversation knows it.
  holder_character_id uuid references public.characters (id) on delete cascade,
  category text not null check (category in ('episodic', 'personal', 'emotional', 'social', 'narrative', 'preference', 'short_term')),
  content text not null check (char_length(content) between 1 and 1000),
  importance real not null default 0.5 check (importance between 0 and 1),
  confidence real not null default 0.8 check (confidence between 0 and 1),
  status text not null default 'active' check (status in ('active', 'superseded', 'invalidated', 'needs_rebuild')),
  superseded_by uuid references public.memories (id) on delete set null,
  edited_by_user boolean not null default false,
  embedding extensions.vector(1536),
  search_document tsvector,
  access_count integer not null default 0,
  last_accessed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index memories_conversation_idx on public.memories (conversation_id, status);
create index memories_user_idx on public.memories (user_id);
create index memories_search_idx on public.memories using gin (search_document);
create index memories_embedding_idx on public.memories using hnsw (embedding extensions.vector_cosine_ops);

-- Which messages a memory was derived from (deletion → invalidation).
create table public.memory_sources (
  memory_id uuid not null references public.memories (id) on delete cascade,
  message_id uuid not null references public.messages (id) on delete cascade,
  primary key (memory_id, message_id)
);
create index memory_sources_message_idx on public.memory_sources (message_id);

-- Rolling summaries of older parts of a conversation path.
create table public.memory_summaries (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  start_message_id uuid references public.messages (id) on delete cascade,
  end_message_id uuid not null references public.messages (id) on delete cascade,
  message_ids uuid[] not null,
  content text not null,
  status text not null default 'active' check (status in ('active', 'invalidated')),
  created_at timestamptz not null default now()
);
create index memory_summaries_conversation_idx on public.memory_summaries (conversation_id, status);
create index memory_summaries_end_idx on public.memory_summaries (end_message_id);
create index memory_summaries_ids_idx on public.memory_summaries using gin (message_ids);

-- Relationships evolve through events; each event is tied to the message that caused it,
-- so the state shown is always the one valid on the current branch.
create table public.relationships (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  subject_character_id uuid not null references public.characters (id) on delete cascade,
  target_label text not null check (char_length(target_label) between 1 and 120),
  target_character_id uuid references public.characters (id) on delete cascade,
  target_is_user boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (conversation_id, subject_character_id, target_label)
);

create table public.relationship_events (
  id uuid primary key default gen_random_uuid(),
  relationship_id uuid not null references public.relationships (id) on delete cascade,
  message_id uuid not null references public.messages (id) on delete cascade,
  kind text not null check (kind in ('friendship', 'trust', 'rivalry', 'enmity', 'family', 'acquaintance', 'romantic', 'other')),
  state text not null check (char_length(state) <= 600),
  change text not null default '' check (char_length(change) <= 600),
  created_at timestamptz not null default now()
);
create index relationship_events_rel_idx on public.relationship_events (relationship_id, created_at);
create index relationship_events_message_idx on public.relationship_events (message_id);

-------------------------------------------------------------------------------
-- Social
-------------------------------------------------------------------------------

create table public.likes (
  user_id uuid not null references public.users (id) on delete cascade,
  character_id uuid not null references public.characters (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, character_id)
);
create index likes_character_idx on public.likes (character_id, created_at desc);

create table public.favorites (
  user_id uuid not null references public.users (id) on delete cascade,
  character_id uuid not null references public.characters (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, character_id)
);
create index favorites_character_idx on public.favorites (character_id);

create table public.ratings (
  user_id uuid not null references public.users (id) on delete cascade,
  character_id uuid not null references public.characters (id) on delete cascade,
  score smallint not null check (score between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, character_id)
);

create table public.follows (
  follower_id uuid not null references public.users (id) on delete cascade,
  following_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);
create index follows_following_idx on public.follows (following_id);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  parent_id uuid references public.comments (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  status text not null default 'visible' check (status in ('visible', 'hidden', 'removed')),
  created_at timestamptz not null default now()
);
create index comments_character_idx on public.comments (character_id, created_at desc);

-------------------------------------------------------------------------------
-- Moderation, notifications, usage, jobs
-------------------------------------------------------------------------------

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.users (id) on delete set null,
  target_type text not null check (target_type in ('character', 'comment', 'user', 'message')),
  target_id uuid not null,
  reason text not null check (reason in ('sexual_minors', 'sexual', 'violence', 'hate', 'harassment', 'self_harm', 'spam', 'impersonation', 'copyright', 'other')),
  details text not null default '' check (char_length(details) <= 1000),
  status text not null default 'open' check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
  resolved_by uuid references public.users (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index reports_status_idx on public.reports (status, created_at);

create table public.moderation_events (
  id uuid primary key default gen_random_uuid(),
  target_type text not null,
  target_id uuid,
  user_id uuid references public.users (id) on delete set null,
  action text not null check (action in ('allow', 'flag', 'block', 'remove', 'restore', 'warn')),
  automated boolean not null default true,
  reason text not null default '',
  details jsonb not null default '{}',
  actor_id uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index moderation_events_target_idx on public.moderation_events (target_type, target_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  type text not null check (type in ('follow', 'like', 'comment', 'moderation', 'system')),
  payload jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.usage_records (
  id bigint generated always as identity primary key,
  user_id uuid references public.users (id) on delete set null,
  conversation_id uuid references public.conversations (id) on delete set null,
  kind text not null,
  provider text not null,
  model text not null,
  tier text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  latency_ms integer,
  success boolean not null default true,
  error text,
  created_at timestamptz not null default now()
);
create index usage_records_user_idx on public.usage_records (user_id, created_at desc);
create index usage_records_created_idx on public.usage_records (created_at);

create table public.jobs (
  id bigint generated always as identity primary key,
  type text not null,
  payload jsonb not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  run_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  dedupe_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jobs_ready_idx on public.jobs (run_at) where status = 'pending';
create unique index jobs_dedupe_idx on public.jobs (dedupe_key) where status = 'pending';
