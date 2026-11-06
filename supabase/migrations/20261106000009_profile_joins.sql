-- Vibuzz — direct foreign keys to public profiles so the API can embed authors
-- (user_profiles.id = users.id, so these never conflict with the existing FKs).
alter table public.comments
  add constraint comments_author_fkey foreign key (user_id) references public.user_profiles (id) on delete cascade;

alter table public.follows
  add constraint follows_follower_profile_fkey foreign key (follower_id) references public.user_profiles (id) on delete cascade,
  add constraint follows_following_profile_fkey foreign key (following_id) references public.user_profiles (id) on delete cascade;

alter table public.blocks
  add constraint blocks_blocked_profile_fkey foreign key (blocked_id) references public.user_profiles (id) on delete cascade;
