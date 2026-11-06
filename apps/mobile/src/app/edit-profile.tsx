import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Avatar, Banner, Button, Field, Ionicons, Screen } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors, space } from '@/lib/theme';
import { pickImage, uploadImage } from '@/lib/upload';

export default function EditProfile() {
  const router = useRouter();
  const { profile, refresh } = useAuth();
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '');
  const [username, setUsername] = useState(profile?.username ?? '');
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [avatar, setAvatar] = useState<string | null>(profile?.avatar_path ?? null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changeAvatar = async () => {
    try {
      const img = await pickImage({ square: true });
      if (!img) return;
      setUploading(true);
      setAvatar(await uploadImage('media', 'avatars', img));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api('/v1/profile', {
        method: 'PATCH',
        body: {
          displayName: displayName.trim(),
          bio: bio.trim(),
          avatarPath: avatar,
          ...(username !== profile?.username ? { username } : {}),
        },
      });
      await refresh();
      router.back();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen keyboard>
      <View style={{ maxWidth: 560, width: '100%', alignSelf: 'center' }}>
        {error ? <Banner tone="danger" text={error} /> : null}
        <Pressable onPress={changeAvatar} style={{ alignSelf: 'center', marginBottom: space.xl }}>
          <Avatar path={avatar} name={displayName} size={104} ring />
          <View style={{ position: 'absolute', right: 2, bottom: 2, width: 32, height: 32, borderRadius: 16, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
            {uploading ? <ActivityIndicator size="small" color={colors.accentInk} /> : <Ionicons name="camera" size={16} color={colors.accentInk} />}
          </View>
        </Pressable>
        <Field label="Nome" value={displayName} onChangeText={setDisplayName} maxLength={50} />
        <Field label="Nome de usuário" value={username} onChangeText={(v) => setUsername(v.toLowerCase().replace(/[^a-z0-9_.]/g, ''))} autoCapitalize="none" maxLength={24} />
        <Field label="Biografia" value={bio} onChangeText={setBio} multiline maxLength={400} />
        <Button title="Salvar" onPress={save} loading={saving} disabled={!displayName.trim() || username.length < 3} />
      </View>
    </Screen>
  );
}
