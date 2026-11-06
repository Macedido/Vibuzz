import * as ImagePicker from 'expo-image-picker';
import { supabase } from './supabase';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 → ArrayBuffer without relying on atob/Buffer. */
export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const len = Math.floor((clean.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
  const bytes = new Uint8Array(Math.max(0, len));
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64.indexOf(clean[i]);
    const b = B64.indexOf(clean[i + 1]);
    const c = B64.indexOf(clean[i + 2]);
    const d = B64.indexOf(clean[i + 3]);
    const n = (a << 18) | (b << 12) | ((c & 63) << 6) | (d & 63);
    if (p < len) bytes[p++] = (n >> 16) & 255;
    if (p < len && c !== -1) bytes[p++] = (n >> 8) & 255;
    if (p < len && d !== -1) bytes[p++] = n & 255;
  }
  return bytes.buffer;
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface PickedImage {
  uri: string;
  base64: string;
  mimeType: string;
}

/** Opens the gallery. Returns null when cancelled or permission denied. */
export async function pickImage(opts: { square?: boolean } = {}): Promise<PickedImage | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error('Permita o acesso às fotos nas configurações do aparelho.');
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: Boolean(opts.square),
    aspect: opts.square ? [1, 1] : undefined,
    quality: 0.7,
    base64: true,
  });
  if (res.canceled || !res.assets?.[0]?.base64) return null;
  const a = res.assets[0];
  return { uri: a.uri, base64: a.base64!, mimeType: a.mimeType ?? 'image/jpeg' };
}

/** Uploads into "<userId>/<folder>/..." of a bucket and returns the storage path. */
export async function uploadImage(bucket: 'media' | 'chat', folder: string, img: PickedImage): Promise<string> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) throw new Error('Faça login novamente.');
  const ext = img.mimeType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg';
  const path = `${userId}/${folder}/${uid()}.${ext}`;
  const { error } = await supabase.storage.from(bucket).upload(path, base64ToArrayBuffer(img.base64), { contentType: img.mimeType, upsert: false });
  if (error) throw new Error(error.message.includes('size') ? 'Imagem muito grande (máx. 10 MB).' : 'Falha ao enviar a imagem.');
  return path;
}
