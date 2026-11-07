-- Vibuzz 2.0: Google sign-in, characters with a life of their own, photos, emotions,
-- relationship meters, push notifications, collections, achievements, weekly ranking, plans.

-------------------------------------------------------------------------------
-- Sign-in with Google: the birthdate is asked on first launch instead of at sign-up.
-------------------------------------------------------------------------------
alter table public.users alter column birthdate drop not null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_birth date;
  v_username text;
  v_display text;
  v_provider text := coalesce(new.raw_app_meta_data ->> 'provider', 'email');
begin
  begin
    v_birth := (new.raw_user_meta_data ->> 'birthdate')::date;
  exception when others then
    v_birth := null;
  end;

  if v_birth is null and v_provider = 'email' then
    raise exception 'birthdate_required' using errcode = 'P0001';
  end if;
  if v_birth is not null and extract(year from age(current_date, v_birth))::integer < 13 then
    raise exception 'underage' using errcode = 'P0001';
  end if;

  v_username := lower(coalesce(new.raw_user_meta_data ->> 'username', ''));
  if v_username !~ '^[a-z0-9_.]{3,24}$'
     or exists (select 1 from public.user_profiles p where lower(p.username) = v_username) then
    v_username := 'user_' || substr(replace(new.id::text, '-', ''), 1, 10);
  end if;

  v_display := left(coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
    v_username), 50);

  insert into public.users (id, birthdate) values (new.id, v_birth);
  insert into public.user_profiles (id, username, display_name) values (new.id, v_username, v_display);
  return new;
end;
$$;

create or replace function public.guard_allow_mature()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.allow_mature and (new.birthdate is null or extract(year from age(current_date, new.birthdate)) < 18) then
    raise exception 'mature_requires_adult' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- Accounts created with Google set their birthdate once (13+).
create or replace function public.complete_signup(p_birthdate date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if p_birthdate is null or p_birthdate > current_date then raise exception 'invalid_birthdate' using errcode = 'P0001'; end if;
  if extract(year from age(current_date, p_birthdate))::integer < 13 then raise exception 'underage' using errcode = 'P0001'; end if;
  update public.users set birthdate = p_birthdate where id = auth.uid() and birthdate is null;
end;
$$;
revoke all on function public.complete_signup(date) from public, anon;
grant execute on function public.complete_signup(date) to authenticated;

-------------------------------------------------------------------------------
-- Preferences and plan
-------------------------------------------------------------------------------
alter table public.users
  add column if not exists voice_enabled boolean not null default false,
  add column if not exists timezone text not null default 'America/Sao_Paulo' check (char_length(timezone) <= 64),
  add column if not exists plan text not null default 'free' check (plan in ('free', 'premium')),
  add column if not exists premium_until timestamptz,
  add column if not exists premium_waitlist boolean not null default false,
  add column if not exists private_mode boolean not null default false;
grant update (voice_enabled, timezone, premium_waitlist, spontaneous_messages, private_mode) on public.users to authenticated;

-- Private mode: collections and activity stay out of public profiles and rankings.
create or replace function private.user_is_private(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select private_mode from public.users where id = p_user), false);
$$;
grant execute on function private.user_is_private(uuid) to anon, authenticated, service_role;

-------------------------------------------------------------------------------
-- Conversations with a life of their own
-------------------------------------------------------------------------------
alter table public.conversations
  add column if not exists proactive_mode text not null default 'off' check (proactive_mode in ('off', 'sometimes', 'often')),
  add column if not exists next_proactive_at timestamptz,
  add column if not exists language text check (language is null or char_length(language) <= 40);
grant update (proactive_mode, language) on public.conversations to authenticated;
create index if not exists conversations_proactive_idx on public.conversations (next_proactive_at) where proactive_mode <> 'off';

-- "Sometimes": once or twice a day. "Often": every few hours while you are away.
create or replace function private.proactive_delay(p_mode text)
returns interval
language sql
volatile
set search_path = pg_catalog
as $$
  select case p_mode
    when 'often' then make_interval(mins => 90 + floor(random() * 150)::int)
    when 'sometimes' then make_interval(hours => 9 + floor(random() * 12)::int)
    else null
  end;
$$;

create or replace function private.schedule_proactive()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.proactive_mode = 'off' then
    new.next_proactive_at := null;
  elsif tg_op = 'INSERT'
     or new.proactive_mode is distinct from old.proactive_mode
     or new.last_message_at is distinct from old.last_message_at then
    new.next_proactive_at := greatest(new.last_message_at, now()) + private.proactive_delay(new.proactive_mode);
  end if;
  return new;
end;
$$;
drop trigger if exists conversations_schedule_proactive on public.conversations;
create trigger conversations_schedule_proactive
  before insert or update of proactive_mode, last_message_at on public.conversations
  for each row execute function private.schedule_proactive();

-- The worker claims due conversations (owner opted in, awake hours in their timezone).
create or replace function public.claim_proactive(p_limit integer default 10)
returns setof uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with due as (
    select c.id
    from public.conversations c
    join public.users u on u.id = c.user_id
    where c.proactive_mode <> 'off'
      and c.next_proactive_at <= now()
      and not c.is_archived
      and c.active_leaf_id is not null
      and u.spontaneous_messages
      and u.status = 'active'
      and u.birthdate is not null
      and extract(hour from now() at time zone coalesce(nullif(u.timezone, ''), 'America/Sao_Paulo')) between 8 and 22
    order by c.next_proactive_at
    limit greatest(1, least(p_limit, 50))
    for update of c skip locked
  )
  update public.conversations c
     set next_proactive_at = now() + interval '30 minutes'
    from due
   where c.id = due.id
  returning c.id;
end;
$$;
revoke all on function public.claim_proactive(integer) from public, anon, authenticated;
grant execute on function public.claim_proactive(integer) to service_role;

-------------------------------------------------------------------------------
-- Messages: emotion, spontaneous flag, translations
-------------------------------------------------------------------------------
alter table public.messages
  add column if not exists emotion text check (emotion is null or emotion in
    ('feliz', 'animado', 'carinho', 'surpresa', 'vergonha', 'triste', 'raiva', 'medo', 'ciume', 'preocupado', 'tedio', 'neutro')),
  add column if not exists is_spontaneous boolean not null default false,
  add column if not exists translations jsonb;
create index if not exists messages_images_idx on public.messages (conversation_id, created_at desc) where cardinality(image_paths) > 0;

-------------------------------------------------------------------------------
-- Relationship meters (0–100), derived from what happened in the story
-------------------------------------------------------------------------------
alter table public.relationships
  add column if not exists meters jsonb not null default '{}'::jsonb,
  add column if not exists mood text check (mood is null or char_length(mood) <= 80);

-------------------------------------------------------------------------------
-- Notifications: new types
-------------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('follow', 'like', 'comment', 'moderation', 'system', 'message', 'achievement'));

-------------------------------------------------------------------------------
-- Web push subscriptions (VAPID keys live in private.settings)
-------------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) <= 1000),
  p256dh text not null check (char_length(p256dh) <= 200),
  auth text not null check (char_length(auth) <= 100),
  user_agent text not null default '' check (char_length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
create policy push_owner_select on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
create policy push_owner_delete on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());
grant select, delete on public.push_subscriptions to authenticated;

create or replace function public.vapid_keys()
returns table (public_key text, private_jwk text)
language sql
stable
security definer
set search_path = private
as $$
  select (select value from private.settings where key = 'vapid_public'),
         (select value from private.settings where key = 'vapid_private');
$$;
create or replace function public.store_vapid_keys(p_public text, p_private text)
returns void
language sql
security definer
set search_path = private
as $$
  insert into private.settings (key, value) values ('vapid_public', p_public), ('vapid_private', p_private)
  on conflict (key) do nothing;
$$;
revoke all on function public.vapid_keys() from public, anon, authenticated;
revoke all on function public.store_vapid_keys(text, text) from public, anon, authenticated;
grant execute on function public.vapid_keys() to service_role;
grant execute on function public.store_vapid_keys(text, text) to service_role;

-------------------------------------------------------------------------------
-- Collections
-------------------------------------------------------------------------------
create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 60),
  description text not null default '' check (char_length(description) <= 300),
  is_public boolean not null default true,
  item_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists collections_owner_idx on public.collections (owner_id, updated_at desc);
alter table public.collections drop constraint if exists collections_owner_profile_fkey;
alter table public.collections
  add constraint collections_owner_profile_fkey foreign key (owner_id) references public.user_profiles (id) on delete cascade;

create table if not exists public.collection_items (
  collection_id uuid not null references public.collections (id) on delete cascade,
  character_id uuid not null references public.characters (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (collection_id, character_id)
);
create index if not exists collection_items_character_idx on public.collection_items (character_id);

alter table public.collections enable row level security;
alter table public.collection_items enable row level security;
create policy collections_read on public.collections for select using (owner_id = auth.uid() or (is_public and not private.user_is_private(owner_id)));
create policy collections_insert on public.collections for insert to authenticated with check (owner_id = auth.uid());
create policy collections_update on public.collections for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy collections_delete on public.collections for delete to authenticated using (owner_id = auth.uid());
create policy collection_items_read on public.collection_items for select
  using (exists (select 1 from public.collections k where k.id = collection_id and (k.owner_id = auth.uid() or (k.is_public and not private.user_is_private(k.owner_id)))));
create policy collection_items_insert on public.collection_items for insert to authenticated
  with check (exists (select 1 from public.collections k where k.id = collection_id and k.owner_id = auth.uid()));
create policy collection_items_delete on public.collection_items for delete to authenticated
  using (exists (select 1 from public.collections k where k.id = collection_id and k.owner_id = auth.uid()));
grant select on public.collections, public.collection_items to anon, authenticated;
grant insert, delete on public.collection_items to authenticated;
grant insert (owner_id, name, description, is_public), update (name, description, is_public), delete on public.collections to authenticated;

create or replace function private.collection_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.collections
     set item_count = (select count(*) from public.collection_items i where i.collection_id = coalesce(new.collection_id, old.collection_id)),
         updated_at = now()
   where id = coalesce(new.collection_id, old.collection_id);
  return null;
end;
$$;
drop trigger if exists collection_items_count on public.collection_items;
create trigger collection_items_count after insert or delete on public.collection_items
  for each row execute function private.collection_count();

-------------------------------------------------------------------------------
-- Achievements
-------------------------------------------------------------------------------
create table if not exists public.achievements (
  code text primary key,
  title text not null,
  description text not null,
  icon text not null,
  metric text not null,
  threshold integer not null,
  sort integer not null default 0
);
alter table public.achievements enable row level security;
create policy achievements_read on public.achievements for select using (true);
grant select on public.achievements to anon, authenticated;

insert into public.achievements (code, title, description, icon, metric, threshold, sort) values
  ('primeiro_oi', 'Primeiro oi', 'Comece sua primeira conversa.', 'chatbubble-ellipses', 'conversations_started', 1, 10),
  ('papo_bom', 'Papo bom', 'Envie 100 mensagens.', 'chatbubbles', 'messages_sent', 100, 20),
  ('maratona', 'Maratona', 'Envie 1.000 mensagens.', 'flame', 'messages_sent', 1000, 30),
  ('explorador', 'Explorador', 'Comece 5 conversas.', 'compass', 'conversations_started', 5, 40),
  ('criador', 'Criador', 'Crie seu primeiro personagem.', 'color-palette', 'characters_created', 1, 50),
  ('estudio', 'Estúdio', 'Crie 5 personagens.', 'film', 'characters_created', 5, 60),
  ('querido', 'Querido pela galera', 'Receba 10 curtidas nos seus personagens.', 'heart', 'likes_received', 10, 70),
  ('famoso', 'Famoso', 'Receba 100 curtidas.', 'star', 'likes_received', 100, 80),
  ('tem_fa', 'Tem fã', 'Ganhe seu primeiro seguidor.', 'person-add', 'followers', 1, 90),
  ('influente', 'Influente', 'Chegue a 50 seguidores.', 'megaphone', 'followers', 50, 100),
  ('album', 'Álbum de fotos', 'Receba 10 fotos dos personagens.', 'images', 'photos_received', 10, 110),
  ('colecionador', 'Colecionador', 'Monte sua primeira coleção.', 'albums', 'collections_made', 1, 120)
on conflict (code) do update set title = excluded.title, description = excluded.description, icon = excluded.icon,
  metric = excluded.metric, threshold = excluded.threshold, sort = excluded.sort;

create table if not exists public.user_stats (
  user_id uuid primary key references public.users (id) on delete cascade,
  messages_sent integer not null default 0,
  conversations_started integer not null default 0,
  characters_created integer not null default 0,
  likes_received integer not null default 0,
  followers integer not null default 0,
  photos_received integer not null default 0,
  collections_made integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.user_stats enable row level security;
create policy user_stats_read on public.user_stats for select using (true);
grant select on public.user_stats to anon, authenticated;

create table if not exists public.user_achievements (
  user_id uuid not null references public.users (id) on delete cascade,
  code text not null references public.achievements (code) on delete cascade,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, code)
);
alter table public.user_achievements enable row level security;
create policy user_achievements_read on public.user_achievements for select using (true);
grant select on public.user_achievements to anon, authenticated;

create or replace function private.bump_stat(p_user uuid, p_metric text, p_delta integer default 1)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_value integer;
  r record;
begin
  if p_user is null then return; end if;
  insert into public.user_stats (user_id) values (p_user) on conflict (user_id) do nothing;
  execute format('update public.user_stats set %1$I = greatest(0, %1$I + $1), updated_at = now() where user_id = $2 returning %1$I', p_metric)
    into v_value using p_delta, p_user;
  for r in
    insert into public.user_achievements (user_id, code)
    select p_user, a.code from public.achievements a where a.metric = p_metric and a.threshold <= v_value
    on conflict do nothing
    returning code
  loop
    insert into public.notifications (user_id, type, payload)
    select p_user, 'achievement', jsonb_build_object('code', a.code, 'title', a.title, 'icon', a.icon) from public.achievements a where a.code = r.code;
  end loop;
end;
$$;

create or replace function private.stats_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'messages' then
    if new.role = 'user' then
      perform private.bump_stat((select user_id from public.conversations where id = new.conversation_id), 'messages_sent');
    end if;
  elsif tg_table_name = 'conversations' then
    perform private.bump_stat(new.user_id, 'conversations_started');
  elsif tg_table_name = 'characters' then
    if new.kind <> 'member' then perform private.bump_stat(new.creator_id, 'characters_created'); end if;
  elsif tg_table_name = 'likes' then
    perform private.bump_stat((select creator_id from public.characters where id = new.character_id), 'likes_received');
  elsif tg_table_name = 'follows' then
    perform private.bump_stat(new.following_id, 'followers');
  elsif tg_table_name = 'collections' then
    perform private.bump_stat(new.owner_id, 'collections_made');
  end if;
  return null;
end;
$$;

create or replace function private.stats_on_photo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role = 'assistant' and cardinality(new.image_paths) > cardinality(coalesce(old.image_paths, '{}')) then
    perform private.bump_stat((select user_id from public.conversations where id = new.conversation_id), 'photos_received',
      cardinality(new.image_paths) - cardinality(coalesce(old.image_paths, '{}')));
  end if;
  return null;
end;
$$;

drop trigger if exists stats_messages on public.messages;
create trigger stats_messages after insert on public.messages for each row execute function private.stats_on_insert();
drop trigger if exists stats_photos on public.messages;
create trigger stats_photos after update of image_paths on public.messages for each row execute function private.stats_on_photo();
drop trigger if exists stats_conversations on public.conversations;
create trigger stats_conversations after insert on public.conversations for each row execute function private.stats_on_insert();
drop trigger if exists stats_characters on public.characters;
create trigger stats_characters after insert on public.characters for each row execute function private.stats_on_insert();
drop trigger if exists stats_likes on public.likes;
create trigger stats_likes after insert on public.likes for each row execute function private.stats_on_insert();
drop trigger if exists stats_follows on public.follows;
create trigger stats_follows after insert on public.follows for each row execute function private.stats_on_insert();
drop trigger if exists stats_collections on public.collections;
create trigger stats_collections after insert on public.collections for each row execute function private.stats_on_insert();

-- Backfill for existing accounts (achievements unlock silently).
insert into public.user_stats (user_id, messages_sent, conversations_started, characters_created, likes_received, followers)
select u.id,
  (select count(*) from public.messages m join public.conversations c on c.id = m.conversation_id where c.user_id = u.id and m.role = 'user'),
  (select count(*) from public.conversations c where c.user_id = u.id),
  (select count(*) from public.characters ch where ch.creator_id = u.id and ch.kind <> 'member'),
  (select count(*) from public.likes l join public.characters ch on ch.id = l.character_id where ch.creator_id = u.id),
  (select count(*) from public.follows f where f.following_id = u.id)
from public.users u
on conflict (user_id) do nothing;
insert into public.user_achievements (user_id, code)
select s.user_id, a.code
from public.user_stats s
join public.achievements a on a.threshold <= case a.metric
  when 'messages_sent' then s.messages_sent when 'conversations_started' then s.conversations_started
  when 'characters_created' then s.characters_created when 'likes_received' then s.likes_received
  when 'followers' then s.followers when 'photos_received' then s.photos_received
  when 'collections_made' then s.collections_made end
on conflict do nothing;

-------------------------------------------------------------------------------
-- Weekly ranking: chats and likes of the last 7 days
-------------------------------------------------------------------------------
-- Aggregates only (counts per character), so it may read past RLS on messages/likes.
create or replace function private.weekly_scores()
returns table (character_id uuid, score integer)
language sql
stable
security definer
set search_path = public
as $$
  select x.id, sum(x.s)::integer
  from (
    select cv.character_id as id, count(distinct cv.user_id) * 10 + count(m.id) as s
    from public.messages m
    join public.conversations cv on cv.id = m.conversation_id
    join public.users u on u.id = cv.user_id
    where m.created_at > now() - interval '7 days' and m.role = 'user' and not u.private_mode
    group by cv.character_id
    union all
    select l.character_id, count(*) * 15
    from public.likes l
    join public.users u on u.id = l.user_id
    where l.created_at > now() - interval '7 days' and not u.private_mode
    group by l.character_id
  ) x
  group by x.id;
$$;
revoke all on function private.weekly_scores() from public;
grant execute on function private.weekly_scores() to anon, authenticated, service_role;

create or replace function public.weekly_ranking(p_limit integer default 30, p_kind text default null)
returns table (rank integer, score integer, card public.character_cards)
language sql
stable
security invoker
set search_path = public
as $$
  with scored as (
    select cc, w.score
    from private.weekly_scores() w
    join public.character_cards cc on cc.id = w.character_id
    join public.characters c on c.id = cc.id
    where w.score > 0
      and cc.visibility = 'public' and c.status = 'active'
      and (p_kind is null or cc.kind = p_kind)
      and (cc.maturity <> 'mature' or cc.creator_id = auth.uid() or private.viewer_allows_mature())
      and not private.is_blocked_pair(auth.uid(), cc.creator_id)
  )
  select (row_number() over (order by score desc, (cc).conversation_count desc, (cc).created_at desc))::integer, score, cc
  from scored
  order by score desc, (cc).conversation_count desc, (cc).created_at desc
  limit greatest(1, least(p_limit, 100));
$$;
grant execute on function public.weekly_ranking(integer, text) to anon, authenticated;

-- Gallery: images inside one conversation (owner only through RLS on messages).
create or replace function public.conversation_gallery(p_conversation uuid, p_limit integer default 200)
returns table (message_id uuid, path text, role text, created_at timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  select m.id, p.path, m.role, m.created_at
  from public.messages m
  cross join lateral unnest(m.image_paths) as p(path)
  where m.conversation_id = p_conversation and m.deleted_at is null
  order by m.created_at desc
  limit greatest(1, least(p_limit, 500));
$$;
grant execute on function public.conversation_gallery(uuid, integer) to authenticated;

-- Path RPC exposes emotion, spontaneous flag and cached translations.
drop function if exists public.conversation_path(uuid, uuid);
create function public.conversation_path(p_conversation uuid, p_leaf uuid default null)
returns table (
  id uuid,
  parent_id uuid,
  depth integer,
  role text,
  speaker_character_id uuid,
  persona_id uuid,
  audience_character_id uuid,
  content text,
  image_paths text[],
  status text,
  is_pinned boolean,
  created_at timestamptz,
  emotion text,
  is_spontaneous boolean,
  translations jsonb,
  sibling_ids uuid[]
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_leaf uuid;
begin
  if auth.uid() is null or not exists (
    select 1 from public.conversations c where c.id = p_conversation and c.user_id = auth.uid()
  ) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  select coalesce(p_leaf, c.active_leaf_id) into v_leaf from public.conversations c where c.id = p_conversation;

  return query
  with recursive path as (
    select m.* from public.messages m where m.id = v_leaf and m.conversation_id = p_conversation
    union all
    select m.* from public.messages m join path p on m.id = p.parent_id
  )
  select
    p.id, p.parent_id, p.depth, p.role, p.speaker_character_id, p.persona_id, p.audience_character_id,
    p.content, p.image_paths, p.status, p.is_pinned, p.created_at, p.emotion, p.is_spontaneous, p.translations,
    coalesce((
      select array_agg(s.id order by s.created_at)
      from public.messages s
      where s.conversation_id = p_conversation
        and s.parent_id is not distinct from p.parent_id
        and s.role = p.role
        and s.deleted_at is null
    ), array[p.id])
  from path p
  where p.deleted_at is null
  order by p.depth;
end;
$$;
revoke execute on function public.conversation_path(uuid, uuid) from public, anon;
grant execute on function public.conversation_path(uuid, uuid) to authenticated, service_role;

-- Character voice (public, like the tagline): chat reads it for text-to-speech.
alter table public.characters add column if not exists voice jsonb;
