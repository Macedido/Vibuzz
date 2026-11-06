-- Vibuzz — Row Level Security
-- Principle: clients read what they own or what is public; anything that needs
-- moderation or AI work is written by the API with the service role.
set search_path = public, extensions;

-------------------------------------------------------------------------------
-- Helpers (security definer → no RLS recursion)
-------------------------------------------------------------------------------
create or replace function public.viewer_allows_mature()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select u.allow_mature and extract(year from age(current_date, u.birthdate)) >= 18
    from public.users u where u.id = auth.uid()
  ), false);
$$;

create or replace function public.is_blocked_pair(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select a is not null and b is not null and exists (
    select 1 from public.blocks
    where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)
  );
$$;

-- Visibility of a top-level (single/group) character for the current viewer.
create or replace function public.character_visible(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.characters c
    where c.id = p_id
      and (
        c.creator_id = auth.uid()
        or (
          c.status = 'active'
          and c.visibility in ('public', 'unlisted')
          and (c.maturity <> 'mature' or public.viewer_allows_mature())
          and not public.is_blocked_pair(auth.uid(), c.creator_id)
        )
      )
  );
$$;

create or replace function public.owns_conversation(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.conversations where id = p_id and user_id = auth.uid());
$$;

-------------------------------------------------------------------------------
-- Enable RLS everywhere
-------------------------------------------------------------------------------
alter table public.users enable row level security;
alter table public.user_profiles enable row level security;
alter table public.blocks enable row level security;
alter table public.personas enable row level security;
alter table public.categories enable row level security;
alter table public.tags enable row level security;
alter table public.characters enable row level security;
alter table public.character_versions enable row level security;
alter table public.character_images enable row level security;
alter table public.character_tags enable row level security;
alter table public.character_groups enable row level security;
alter table public.group_members enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.message_branches enable row level security;
alter table public.memories enable row level security;
alter table public.memory_sources enable row level security;
alter table public.memory_summaries enable row level security;
alter table public.relationships enable row level security;
alter table public.relationship_events enable row level security;
alter table public.likes enable row level security;
alter table public.favorites enable row level security;
alter table public.ratings enable row level security;
alter table public.follows enable row level security;
alter table public.comments enable row level security;
alter table public.reports enable row level security;
alter table public.moderation_events enable row level security;
alter table public.notifications enable row level security;
alter table public.usage_records enable row level security;
alter table public.jobs enable row level security;

-- Server-managed tables: clients may never write them directly.
revoke insert, update, delete on
  public.user_profiles, public.categories, public.tags, public.characters, public.character_versions,
  public.character_images, public.character_tags, public.character_groups, public.group_members,
  public.conversations, public.conversation_members, public.messages, public.message_branches,
  public.memories, public.memory_sources, public.memory_summaries, public.relationships,
  public.relationship_events, public.comments, public.moderation_events, public.notifications,
  public.usage_records, public.users
from anon, authenticated;
revoke all on public.jobs, public.moderation_events from anon, authenticated;

-- Narrow column updates that are safe for the owner to do directly.
grant update (allow_mature, spontaneous_messages) on public.users to authenticated;
grant update (title, is_favorite, is_archived, persona_id, creativity) on public.conversations to authenticated;
grant delete on public.conversations to authenticated;
grant update (is_pinned) on public.messages to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant delete on public.memories to authenticated;
grant delete on public.comments to authenticated;

-------------------------------------------------------------------------------
-- Accounts
-------------------------------------------------------------------------------
create policy users_self_select on public.users for select to authenticated using (id = auth.uid());
create policy users_self_update on public.users for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy profiles_read on public.user_profiles for select to anon, authenticated
  using (not public.is_blocked_pair(auth.uid(), id));

create policy blocks_own on public.blocks for all to authenticated
  using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());

create policy personas_own on public.personas for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-------------------------------------------------------------------------------
-- Catalog and characters
-------------------------------------------------------------------------------
create policy categories_read on public.categories for select to anon, authenticated using (true);
create policy tags_read on public.tags for select to anon, authenticated using (true);

create policy characters_read on public.characters for select to anon, authenticated
  using (
    creator_id = auth.uid()
    or (
      status = 'active'
      and (maturity <> 'mature' or public.viewer_allows_mature())
      and not public.is_blocked_pair(auth.uid(), creator_id)
      and case when kind = 'member'
               then public.character_visible(parent_group_id)
               else visibility in ('public', 'unlisted') end
    )
  );

-- Full sheets (with creator instructions) are visible to the creator only.
create policy versions_creator on public.character_versions for select to authenticated
  using (exists (select 1 from public.characters c where c.id = character_id and c.creator_id = auth.uid()));

create policy character_images_read on public.character_images for select to anon, authenticated
  using (exists (select 1 from public.characters c where c.id = character_id));

create policy character_tags_read on public.character_tags for select to anon, authenticated
  using (exists (select 1 from public.characters c where c.id = character_id));

create policy character_groups_read on public.character_groups for select to anon, authenticated
  using (exists (select 1 from public.characters c where c.id = character_id));

create policy group_members_read on public.group_members for select to anon, authenticated
  using (exists (select 1 from public.characters c where c.id = group_id));

-------------------------------------------------------------------------------
-- Conversations (private)
-------------------------------------------------------------------------------
create policy conversations_own_select on public.conversations for select to authenticated using (user_id = auth.uid());
create policy conversations_own_update on public.conversations for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (persona_id is null or exists (select 1 from public.personas p where p.id = persona_id and p.owner_id = auth.uid()))
  );
create policy conversations_own_delete on public.conversations for delete to authenticated using (user_id = auth.uid());

create policy conversation_members_own on public.conversation_members for select to authenticated
  using (public.owns_conversation(conversation_id));

create policy messages_own_select on public.messages for select to authenticated
  using (deleted_at is null and public.owns_conversation(conversation_id));
create policy messages_own_pin on public.messages for update to authenticated
  using (deleted_at is null and public.owns_conversation(conversation_id))
  with check (public.owns_conversation(conversation_id));

create policy branches_own on public.message_branches for select to authenticated
  using (public.owns_conversation(conversation_id));

-------------------------------------------------------------------------------
-- Memory (private, per user)
-------------------------------------------------------------------------------
create policy memories_own_select on public.memories for select to authenticated
  using (user_id = auth.uid() and status in ('active', 'needs_rebuild'));
create policy memories_own_delete on public.memories for delete to authenticated using (user_id = auth.uid());

create policy memory_sources_own on public.memory_sources for select to authenticated
  using (exists (select 1 from public.memories m where m.id = memory_id and m.user_id = auth.uid()));

create policy summaries_own on public.memory_summaries for select to authenticated
  using (public.owns_conversation(conversation_id));

create policy relationships_own on public.relationships for select to authenticated using (user_id = auth.uid());
create policy relationship_events_own on public.relationship_events for select to authenticated
  using (exists (select 1 from public.relationships r where r.id = relationship_id and r.user_id = auth.uid()));

-------------------------------------------------------------------------------
-- Social
-------------------------------------------------------------------------------
create policy likes_own on public.likes for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.character_visible(character_id));

create policy favorites_own on public.favorites for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.character_visible(character_id));

create policy ratings_read on public.ratings for select to authenticated using (user_id = auth.uid());
create policy ratings_write on public.ratings for insert to authenticated
  with check (user_id = auth.uid() and public.character_visible(character_id));
create policy ratings_update on public.ratings for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy ratings_delete on public.ratings for delete to authenticated using (user_id = auth.uid());

create policy follows_read on public.follows for select to anon, authenticated using (true);
create policy follows_write on public.follows for insert to authenticated
  with check (follower_id = auth.uid() and not public.is_blocked_pair(follower_id, following_id));
create policy follows_delete on public.follows for delete to authenticated using (follower_id = auth.uid());

create policy comments_read on public.comments for select to anon, authenticated
  using (
    (status = 'visible' or user_id = auth.uid())
    and public.character_visible(character_id)
    and not public.is_blocked_pair(auth.uid(), user_id)
  );
create policy comments_delete on public.comments for delete to authenticated using (user_id = auth.uid());

-------------------------------------------------------------------------------
-- Reports, notifications, usage
-------------------------------------------------------------------------------
create policy reports_insert on public.reports for insert to authenticated with check (reporter_id = auth.uid());
create policy reports_own on public.reports for select to authenticated using (reporter_id = auth.uid());

create policy notifications_own on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_read on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy usage_own on public.usage_records for select to authenticated using (user_id = auth.uid());
