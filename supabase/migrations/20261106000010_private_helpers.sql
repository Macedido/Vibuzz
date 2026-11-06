-- Vibuzz — hide internal helpers from the public REST API (Supabase security advisor)
-- Policies reference functions by OID, so moving them keeps every RLS policy working.
create schema if not exists private;
grant usage on schema private to anon, authenticated, service_role;

alter function public.viewer_allows_mature() set schema private;
alter function public.is_blocked_pair(uuid, uuid) set schema private;
alter function public.character_visible(uuid) set schema private;
alter function public.owns_conversation(uuid) set schema private;
alter function public.trending_score(uuid) set schema private;

-- Bodies that call other helpers by name must point to the new schema.
create or replace function private.character_visible(p_id uuid)
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
          and (c.maturity <> 'mature' or private.viewer_allows_mature())
          and not private.is_blocked_pair(auth.uid(), c.creator_id)
        )
      )
  );
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
    case when p_sort = 'trending' then private.trending_score(c.id) end desc nulls last,
    (c.like_count * 3 + c.favorite_count * 4 + c.conversation_count + c.rating_sum) desc,
    c.created_at desc
  limit least(greatest(p_limit, 1), 50)
  offset greatest(p_offset, 0);
end;
$$;

-- Trigger functions are never meant to be called directly.
revoke execute on function public.bump_counter() from public, anon, authenticated;
revoke execute on function public.ratings_counter() from public, anon, authenticated;
revoke execute on function public.notify_social() from public, anon, authenticated;
