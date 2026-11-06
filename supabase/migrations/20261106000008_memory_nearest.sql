-- Vibuzz — nearest-neighbour lookup used for memory de-duplication
set search_path = public, extensions;

create or replace function public.nearest_memories(
  p_conversation uuid,
  p_embedding extensions.vector(1536),
  p_limit integer default 8
)
returns table (id uuid, content text, category text, holder_character_id uuid, importance real, similarity double precision)
language sql
stable
set search_path = public, extensions
as $$
  select m.id, m.content, m.category, m.holder_character_id, m.importance, 1 - (m.embedding <=> p_embedding) as similarity
  from public.memories m
  where m.conversation_id = p_conversation
    and m.status = 'active'
    and m.embedding is not null
  order by m.embedding <=> p_embedding
  limit least(greatest(p_limit, 1), 50);
$$;

revoke execute on function public.nearest_memories(uuid, extensions.vector, integer) from public, anon, authenticated;
grant execute on function public.nearest_memories(uuid, extensions.vector, integer) to service_role;

-- Full rows along a path (server use; avoids long id lists in URLs).
create or replace function public.path_messages(p_leaf uuid)
returns setof public.messages
language sql
stable
set search_path = public
as $$
  with recursive path as (
    select m.* from public.messages m where m.id = p_leaf
    union all
    select m.* from public.messages m join path p on m.id = p.parent_id
  )
  select * from path order by depth;
$$;

create or replace function public.path_summaries(p_conversation uuid, p_path uuid[])
returns table (id uuid, end_message_id uuid, content text, end_index integer)
language sql
stable
set search_path = public
as $$
  select s.id, s.end_message_id, s.content, array_position(p_path, s.end_message_id) as end_index
  from public.memory_summaries s
  where s.conversation_id = p_conversation
    and s.status = 'active'
    and s.end_message_id = any(p_path)
  order by end_index;
$$;

-- Everything derived from a set of messages (used when they are deleted).
create or replace function public.derived_from_messages(p_messages uuid[])
returns table (kind text, id uuid, conversation_id uuid)
language sql
stable
set search_path = public
as $$
  select distinct 'memory', s.memory_id, m.conversation_id
  from public.memory_sources s join public.memories m on m.id = s.memory_id
  where s.message_id = any(p_messages)
  union all
  select 'summary', ms.id, ms.conversation_id
  from public.memory_summaries ms
  where ms.message_ids && p_messages;
$$;

revoke execute on function public.path_messages(uuid) from public, anon, authenticated;
revoke execute on function public.path_summaries(uuid, uuid[]) from public, anon, authenticated;
revoke execute on function public.derived_from_messages(uuid[]) from public, anon, authenticated;
grant execute on function public.path_messages(uuid) to service_role;
grant execute on function public.path_summaries(uuid, uuid[]) to service_role;
grant execute on function public.derived_from_messages(uuid[]) to service_role;

-- A message and all its descendants (used by "replace" edits).
create or replace function public.subtree_ids(p_message uuid)
returns uuid[]
language sql
stable
set search_path = public
as $$
  with recursive t as (
    select id from public.messages where id = p_message
    union all
    select m.id from public.messages m join t on m.parent_id = t.id
  )
  select coalesce(array_agg(id), '{}') from t;
$$;

-- Today's AI usage for quota checks.
create or replace function public.usage_today(p_user uuid)
returns table (chat_messages bigint, cost_usd numeric)
language sql
stable
set search_path = public
as $$
  select
    count(*) filter (where kind in ('chat', 'chat_continue') and success),
    coalesce(sum(cost_usd), 0)
  from public.usage_records
  where user_id = p_user and created_at >= date_trunc('day', now());
$$;

revoke execute on function public.subtree_ids(uuid) from public, anon, authenticated;
revoke execute on function public.usage_today(uuid) from public, anon, authenticated;
grant execute on function public.subtree_ids(uuid) to service_role;
grant execute on function public.usage_today(uuid) to service_role;
