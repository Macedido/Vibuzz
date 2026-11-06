-- Vibuzz — read models and RPC functions
set search_path = public, extensions;

-------------------------------------------------------------------------------
-- Character cards (discovery read model). security_invoker → RLS applies.
-------------------------------------------------------------------------------
create or replace view public.character_cards
with (security_invoker = true) as
select
  c.id,
  c.kind,
  c.name,
  c.tagline,
  c.description,
  c.greeting_preview,
  c.avatar_path,
  c.visibility,
  c.maturity,
  c.category_slug,
  c.status,
  c.conversation_count,
  c.like_count,
  c.favorite_count,
  c.comment_count,
  case when c.rating_count > 0 then round(c.rating_sum::numeric / c.rating_count, 2) end as rating,
  c.rating_count,
  c.published_at,
  c.created_at,
  c.creator_id,
  p.username as creator_username,
  p.display_name as creator_display_name,
  p.avatar_path as creator_avatar_path,
  coalesce((
    select array_agg(t.name order by t.name)
    from public.character_tags ct join public.tags t on t.id = ct.tag_id
    where ct.character_id = c.id
  ), '{}') as tags,
  (select count(*) from public.group_members gm where gm.group_id = c.id)::integer as member_count
from public.characters c
join public.user_profiles p on p.id = c.creator_id
where c.kind <> 'member';

grant select on public.character_cards to anon, authenticated;

-- Activity in the last 7 days (aggregate only, so it may read past RLS).
create or replace function public.trending_score(p_character uuid)
returns double precision
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*) from public.conversations where character_id = p_character and created_at > now() - interval '7 days') * 2.0
    + (select count(*) from public.likes where character_id = p_character and created_at > now() - interval '7 days') * 1.0
    + (select count(*) from public.favorites where character_id = p_character and created_at > now() - interval '7 days') * 1.5;
$$;

create or replace function public.discover_characters(
  p_query text default null,
  p_category text default null,
  p_tags text[] default null,
  p_sort text default 'popular',
  p_kind text default null,
  p_creator uuid default null,
  p_following_only boolean default false,
  p_limit integer default 20,
  p_offset integer default 0
)
returns setof public.character_cards
language plpgsql
stable
security invoker
set search_path = public, extensions
as $$
declare
  v_q text := nullif(trim(coalesce(p_query, '')), '');
  v_tsq tsquery;
begin
  if v_q is not null then
    v_tsq := websearch_to_tsquery('simple', public.f_unaccent(v_q));
  end if;

  return query
  select cc.*
  from public.character_cards cc
  join public.characters c on c.id = cc.id
  where cc.visibility = 'public'
    and c.status = 'active'
    and (p_category is null or cc.category_slug = p_category)
    and (p_kind is null or cc.kind = p_kind)
    and (p_creator is null or cc.creator_id = p_creator)
    and (not p_following_only or cc.creator_id in (select following_id from public.follows where follower_id = auth.uid()))
    and (
      p_tags is null or cardinality(p_tags) = 0 or exists (
        select 1 from public.character_tags ct join public.tags t on t.id = ct.tag_id
        where ct.character_id = cc.id and t.slug = any(p_tags)
      )
    )
    and (
      v_q is null
      or c.search_document @@ v_tsq
      or c.name ilike '%' || v_q || '%'
      or cc.creator_username ilike v_q || '%'
      or extensions.similarity(c.name, v_q) > 0.3
    )
  order by
    case when v_q is not null then ts_rank(c.search_document, v_tsq) + extensions.similarity(c.name, v_q) end desc nulls last,
    case when p_sort = 'recent' then coalesce(c.published_at, c.created_at) end desc nulls last,
    case when p_sort = 'most_chatted' then c.conversation_count end desc nulls last,
    case when p_sort = 'most_liked' then c.like_count end desc nulls last,
    case when p_sort = 'trending' then public.trending_score(c.id) end desc nulls last,
    (c.like_count * 3 + c.favorite_count * 4 + c.conversation_count + c.rating_sum) desc,
    c.created_at desc
  limit least(greatest(p_limit, 1), 50)
  offset greatest(p_offset, 0);
end;
$$;

-- Personalised recommendations: taste (categories, tags, embeddings) + follows + light popularity.
create or replace function public.recommend_characters(p_limit integer default 20)
returns setof public.character_cards
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with mine as (
    select distinct character_id from public.conversations where user_id = auth.uid()
  ),
  cat as (
    select c.category_slug, count(*)::double precision as w
    from public.conversations cv join public.characters c on c.id = cv.character_id
    where cv.user_id = auth.uid() and c.category_slug is not null
    group by 1
  ),
  tag as (
    select ct.tag_id, count(*)::double precision as w
    from public.conversations cv join public.character_tags ct on ct.character_id = cv.character_id
    where cv.user_id = auth.uid()
    group by 1
  ),
  centroid as (
    select avg(c.embedding) as e
    from public.characters c
    where c.id in (select character_id from mine) and c.embedding is not null
  )
  select cc.*
  from public.character_cards cc
  join public.characters c on c.id = cc.id
  cross join centroid
  where cc.visibility = 'public'
    and c.status = 'active'
    and cc.creator_id is distinct from auth.uid()
    and cc.id not in (select character_id from mine)
  order by (
    coalesce((select cat.w from cat where cat.category_slug = c.category_slug), 0) * 1.5
    + coalesce((select sum(tag.w) from tag join public.character_tags ct on ct.tag_id = tag.tag_id where ct.character_id = c.id), 0)
    + case when c.creator_id in (select following_id from public.follows where follower_id = auth.uid()) then 3 else 0 end
    + case when centroid.e is not null and c.embedding is not null then (1 - (c.embedding <=> centroid.e)) * 6 else 0 end
    + ln(1 + c.conversation_count + c.like_count * 2) * 0.6
    + case when c.published_at > now() - interval '14 days' then 1 else 0 end
  ) desc, c.created_at desc
  limit least(greatest(p_limit, 1), 50);
$$;

create or replace function public.creator_stats(p_user uuid)
returns table (characters integer, conversations bigint, likes bigint, favorites bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select count(*)::integer, coalesce(sum(conversation_count), 0), coalesce(sum(like_count), 0), coalesce(sum(favorite_count), 0)
  from public.characters
  where creator_id = p_user and kind <> 'member' and status = 'active';
$$;

create or replace function public.is_username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_username ~ '^[a-z0-9_.]{3,24}$'
     and not exists (select 1 from public.user_profiles where lower(username) = lower(p_username));
$$;
grant execute on function public.is_username_available(text) to anon, authenticated;

-------------------------------------------------------------------------------
-- Conversation tree
-------------------------------------------------------------------------------

-- Active path of a conversation, with alternatives (siblings) for branch navigation.
create or replace function public.conversation_path(p_conversation uuid, p_leaf uuid default null)
returns table (
  id uuid,
  parent_id uuid,
  depth integer,
  role text,
  speaker_character_id uuid,
  persona_id uuid,
  content text,
  image_paths text[],
  status text,
  is_pinned boolean,
  created_at timestamptz,
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
    p.id, p.parent_id, p.depth, p.role, p.speaker_character_id, p.persona_id, p.content, p.image_paths,
    p.status, p.is_pinned, p.created_at,
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
grant execute on function public.conversation_path(uuid, uuid) to authenticated;

create or replace function public.search_messages(p_conversation uuid, p_query text)
returns table (id uuid, role text, content text, created_at timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  select m.id, m.role, m.content, m.created_at
  from public.messages m
  where m.conversation_id = p_conversation
    and m.deleted_at is null
    and length(trim(p_query)) > 0
    and (to_tsvector('simple', m.content) @@ websearch_to_tsquery('simple', p_query) or m.content ilike '%' || p_query || '%')
  order by m.created_at desc
  limit 50;
$$;

-- Ancestors of a message, root first (server use).
create or replace function public.message_path_ids(p_leaf uuid)
returns uuid[]
language sql
stable
set search_path = public
as $$
  with recursive path as (
    select id, parent_id, depth from public.messages where id = p_leaf
    union all
    select m.id, m.parent_id, m.depth from public.messages m join path p on m.id = p.parent_id
  )
  select coalesce(array_agg(id order by depth), '{}') from path;
$$;

-- Follow the most recent visible child until a leaf (used when switching branches).
create or replace function public.deepest_leaf(p_message uuid)
returns uuid
language plpgsql
stable
set search_path = public
as $$
declare
  v uuid := p_message;
  n uuid;
begin
  loop
    n := null;
    select m.id into n from public.messages m
    where m.parent_id = v and m.deleted_at is null
    order by m.created_at desc limit 1;
    exit when n is null;
    v := n;
  end loop;
  return v;
end;
$$;

-------------------------------------------------------------------------------
-- Memory retrieval (hybrid: semantic + keyword + importance + recency),
-- restricted to memories whose source messages are on the current branch.
-------------------------------------------------------------------------------
create or replace function public.match_memories(
  p_conversation uuid,
  p_holder uuid,
  p_path uuid[],
  p_embedding extensions.vector(1536),
  p_query text,
  p_limit integer default 12
)
returns table (
  id uuid,
  category text,
  content text,
  importance real,
  confidence real,
  holder_character_id uuid,
  created_at timestamptz,
  score double precision
)
language sql
stable
set search_path = public, extensions
as $$
  select
    m.id, m.category, m.content, m.importance, m.confidence, m.holder_character_id, m.created_at,
    (case when p_embedding is null or m.embedding is null then 0 else 1 - (m.embedding <=> p_embedding) end) * 0.55
    + least(coalesce(ts_rank(m.search_document, websearch_to_tsquery('simple', public.f_unaccent(coalesce(p_query, '')))), 0), 1) * 0.15
    + m.importance * 0.2
    + exp(-extract(epoch from (now() - m.created_at)) / (86400.0 * 30)) * 0.1 as score
  from public.memories m
  where m.conversation_id = p_conversation
    and m.status = 'active'
    and (p_holder is null or m.holder_character_id is null or m.holder_character_id = p_holder)
    and exists (select 1 from public.memory_sources s where s.memory_id = m.id and s.message_id = any(p_path))
  order by score desc
  limit least(greatest(p_limit, 1), 50);
$$;

-- Most important memories regardless of the current topic.
create or replace function public.core_memories(
  p_conversation uuid,
  p_holder uuid,
  p_path uuid[],
  p_limit integer default 8
)
returns table (id uuid, category text, content text, importance real, holder_character_id uuid, created_at timestamptz)
language sql
stable
set search_path = public
as $$
  select m.id, m.category, m.content, m.importance, m.holder_character_id, m.created_at
  from public.memories m
  where m.conversation_id = p_conversation
    and m.status = 'active'
    and m.importance >= 0.7
    and (p_holder is null or m.holder_character_id is null or m.holder_character_id = p_holder)
    and exists (select 1 from public.memory_sources s where s.memory_id = m.id and s.message_id = any(p_path))
  order by m.importance desc, m.created_at desc
  limit least(greatest(p_limit, 1), 30);
$$;

-- Current relationship state on a branch = latest event whose message is on the path.
create or replace function public.relationship_states(p_conversation uuid, p_path uuid[])
returns table (
  relationship_id uuid,
  subject_character_id uuid,
  target_label text,
  target_is_user boolean,
  kind text,
  state text,
  updated_at timestamptz
)
language sql
stable
set search_path = public
as $$
  select distinct on (r.id)
    r.id, r.subject_character_id, r.target_label, r.target_is_user, e.kind, e.state, e.created_at
  from public.relationships r
  join public.relationship_events e on e.relationship_id = r.id
  where r.conversation_id = p_conversation
    and e.message_id = any(p_path)
  order by r.id, e.created_at desc;
$$;

-------------------------------------------------------------------------------
-- Job queue (Postgres-based, SKIP LOCKED). Service role only.
-------------------------------------------------------------------------------
create or replace function public.enqueue_job(
  p_type text,
  p_payload jsonb,
  p_dedupe_key text default null,
  p_delay_seconds integer default 0
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
begin
  insert into public.jobs (type, payload, dedupe_key, run_at)
  values (p_type, coalesce(p_payload, '{}'), p_dedupe_key, now() + make_interval(secs => greatest(p_delay_seconds, 0)))
  on conflict (dedupe_key) where status = 'pending' do nothing
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.claim_jobs(p_worker text, p_limit integer default 5)
returns setof public.jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.jobs j
  set status = 'running', locked_at = now(), locked_by = p_worker, attempts = j.attempts + 1
  where j.id in (
    select q.id from public.jobs q
    where (q.status = 'pending' and q.run_at <= now())
       or (q.status = 'running' and q.locked_at < now() - interval '10 minutes')
    order by q.run_at
    limit greatest(p_limit, 1)
    for update skip locked
  )
  returning j.*;
end;
$$;

-------------------------------------------------------------------------------
-- Privileges for server-only functions
-------------------------------------------------------------------------------
revoke execute on function public.enqueue_job(text, jsonb, text, integer) from public, anon, authenticated;
revoke execute on function public.claim_jobs(text, integer) from public, anon, authenticated;
revoke execute on function public.message_path_ids(uuid) from public, anon, authenticated;
revoke execute on function public.deepest_leaf(uuid) from public, anon, authenticated;
revoke execute on function public.match_memories(uuid, uuid, uuid[], extensions.vector, text, integer) from public, anon, authenticated;
revoke execute on function public.core_memories(uuid, uuid, uuid[], integer) from public, anon, authenticated;
revoke execute on function public.relationship_states(uuid, uuid[]) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

grant execute on function public.enqueue_job(text, jsonb, text, integer) to service_role;
grant execute on function public.claim_jobs(text, integer) to service_role;
grant execute on function public.message_path_ids(uuid) to service_role;
grant execute on function public.deepest_leaf(uuid) to service_role;
grant execute on function public.match_memories(uuid, uuid, uuid[], extensions.vector, text, integer) to service_role;
grant execute on function public.core_memories(uuid, uuid, uuid[], integer) to service_role;
grant execute on function public.relationship_states(uuid, uuid[]) to service_role;
