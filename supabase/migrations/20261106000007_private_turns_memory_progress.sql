-- Vibuzz — private turns inside groups + memory processing progress
set search_path = public, extensions;

-- In a group conversation, a message can be addressed privately to one member.
-- Other members never see it, and memories derived from it belong to that member only.
alter table public.messages
  add column audience_character_id uuid references public.characters (id) on delete set null,
  add column memory_processed_at timestamptz;

create index messages_unprocessed_idx on public.messages (conversation_id, created_at)
  where memory_processed_at is null and deleted_at is null;

-- Recreate the path RPC to expose the audience.
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
    p.content, p.image_paths, p.status, p.is_pinned, p.created_at,
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
