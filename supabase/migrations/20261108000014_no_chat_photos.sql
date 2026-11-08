-- Characters no longer send photos in the chat: drop the badge that depended on it.
delete from public.achievements where code = 'album';
