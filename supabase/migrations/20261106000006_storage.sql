-- Vibuzz — storage buckets
-- media: avatars and character images (public read, owner writes into <uid>/...)
-- chat:  images sent inside conversations (private, owner only; API reads with service role)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('media', 'media', true, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  ('chat', 'chat', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

create policy media_public_read on storage.objects for select
  using (bucket_id = 'media');

create policy media_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

create policy media_owner_update on storage.objects for update to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

create policy media_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

create policy chat_owner_all on storage.objects for all to authenticated
  using (bucket_id = 'chat' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'chat' and (storage.foldername(name))[1] = auth.uid()::text);
