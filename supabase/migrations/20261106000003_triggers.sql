-- Vibuzz — triggers: timestamps, signup, search documents, counters
set search_path = public, extensions;

-- updated_at
create trigger users_updated_at before update on public.users for each row execute function public.set_updated_at();
create trigger user_profiles_updated_at before update on public.user_profiles for each row execute function public.set_updated_at();
create trigger personas_updated_at before update on public.personas for each row execute function public.set_updated_at();
create trigger characters_updated_at before update on public.characters for each row execute function public.set_updated_at();
create trigger conversations_updated_at before update on public.conversations for each row execute function public.set_updated_at();
create trigger memories_updated_at before update on public.memories for each row execute function public.set_updated_at();
create trigger relationships_updated_at before update on public.relationships for each row execute function public.set_updated_at();
create trigger ratings_updated_at before update on public.ratings for each row execute function public.set_updated_at();
create trigger jobs_updated_at before update on public.jobs for each row execute function public.set_updated_at();

-------------------------------------------------------------------------------
-- Signup: create users + user_profiles from auth metadata, enforce minimum age.
-------------------------------------------------------------------------------
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
  v_age integer;
begin
  begin
    v_birth := (new.raw_user_meta_data ->> 'birthdate')::date;
  exception when others then
    v_birth := null;
  end;

  if v_birth is null then
    raise exception 'birthdate_required' using errcode = 'P0001';
  end if;

  v_age := extract(year from age(current_date, v_birth))::integer;
  if v_age < 13 then
    raise exception 'underage' using errcode = 'P0001';
  end if;

  v_username := lower(coalesce(new.raw_user_meta_data ->> 'username', ''));
  if v_username !~ '^[a-z0-9_.]{3,24}$'
     or exists (select 1 from public.user_profiles p where lower(p.username) = v_username) then
    v_username := 'user_' || substr(replace(new.id::text, '-', ''), 1, 10);
  end if;

  v_display := left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), v_username), 50);

  insert into public.users (id, birthdate) values (new.id, v_birth);
  insert into public.user_profiles (id, username, display_name) values (new.id, v_username, v_display);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Mature content can only be enabled by adults.
create or replace function public.guard_allow_mature()
returns trigger
language plpgsql
as $$
begin
  if new.allow_mature and extract(year from age(current_date, new.birthdate)) < 18 then
    raise exception 'mature_requires_adult' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger users_guard_mature before insert or update on public.users for each row execute function public.guard_allow_mature();

-------------------------------------------------------------------------------
-- Search documents
-------------------------------------------------------------------------------
create or replace function public.characters_search_document()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  new.search_document :=
    setweight(to_tsvector('simple', public.f_unaccent(new.name)), 'A') ||
    setweight(to_tsvector('simple', public.f_unaccent(new.tagline)), 'B') ||
    setweight(to_tsvector('simple', public.f_unaccent(new.search_text)), 'C') ||
    setweight(to_tsvector('simple', public.f_unaccent(new.description)), 'D');
  return new;
end;
$$;
create trigger characters_search before insert or update of name, tagline, description, search_text
  on public.characters for each row execute function public.characters_search_document();

create or replace function public.memories_search_document()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  new.search_document := to_tsvector('simple', public.f_unaccent(new.content));
  return new;
end;
$$;
create trigger memories_search before insert or update of content
  on public.memories for each row execute function public.memories_search_document();

-------------------------------------------------------------------------------
-- Counters (security definer: they touch rows the actor cannot update)
-------------------------------------------------------------------------------
create or replace function public.bump_counter()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  d integer := case when tg_op = 'INSERT' then 1 else -1 end;
  r record := case when tg_op = 'INSERT' then new else old end;
begin
  if tg_table_name = 'likes' then
    update public.characters set like_count = greatest(0, like_count + d) where id = r.character_id;
  elsif tg_table_name = 'favorites' then
    update public.characters set favorite_count = greatest(0, favorite_count + d) where id = r.character_id;
  elsif tg_table_name = 'comments' then
    update public.characters set comment_count = greatest(0, comment_count + d) where id = r.character_id;
  elsif tg_table_name = 'conversations' then
    update public.characters set conversation_count = greatest(0, conversation_count + d) where id = r.character_id;
  elsif tg_table_name = 'follows' then
    update public.user_profiles set follower_count = greatest(0, follower_count + d) where id = r.following_id;
    update public.user_profiles set following_count = greatest(0, following_count + d) where id = r.follower_id;
  elsif tg_table_name = 'characters' then
    if r.kind <> 'member' then
      update public.user_profiles set character_count = greatest(0, character_count + d) where id = r.creator_id;
    end if;
  end if;
  return null;
end;
$$;

create trigger likes_count after insert or delete on public.likes for each row execute function public.bump_counter();
create trigger favorites_count after insert or delete on public.favorites for each row execute function public.bump_counter();
create trigger comments_count after insert or delete on public.comments for each row execute function public.bump_counter();
create trigger conversations_count after insert on public.conversations for each row execute function public.bump_counter();
create trigger follows_count after insert or delete on public.follows for each row execute function public.bump_counter();
create trigger characters_count after insert or delete on public.characters for each row execute function public.bump_counter();

create or replace function public.ratings_counter()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.characters set rating_sum = rating_sum + new.score, rating_count = rating_count + 1 where id = new.character_id;
  elsif tg_op = 'UPDATE' then
    update public.characters set rating_sum = rating_sum - old.score + new.score where id = new.character_id;
  elsif tg_op = 'DELETE' then
    update public.characters set rating_sum = greatest(0, rating_sum - old.score), rating_count = greatest(0, rating_count - 1) where id = old.character_id;
  end if;
  return null;
end;
$$;
create trigger ratings_count after insert or update or delete on public.ratings for each row execute function public.ratings_counter();

-- Notifications for follows and comments.
create or replace function public.notify_social()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  if tg_table_name = 'follows' then
    insert into public.notifications (user_id, type, payload)
    values (new.following_id, 'follow', jsonb_build_object('user_id', new.follower_id));
  elsif tg_table_name = 'comments' then
    select creator_id into v_owner from public.characters where id = new.character_id;
    if v_owner is not null and v_owner <> new.user_id then
      insert into public.notifications (user_id, type, payload)
      values (v_owner, 'comment', jsonb_build_object('user_id', new.user_id, 'character_id', new.character_id, 'comment_id', new.id));
    end if;
  end if;
  return null;
end;
$$;
create trigger follows_notify after insert on public.follows for each row execute function public.notify_social();
create trigger comments_notify after insert on public.comments for each row execute function public.notify_social();
