import type { Db } from './db';
import { AppError, forbidden } from './errors';

export type Bucket = 'media' | 'chat';

const MAX_INLINE_IMAGE_BYTES = 4_500_000;

/** Paths are always "<ownerId>/..."; callers must only use paths owned by the acting user. */
export function assertOwnedPath(path: string, userId: string) {
  if (!path || path.includes('..') || !path.startsWith(`${userId}/`)) throw forbidden('Arquivo inválido.');
}

export class StorageService {
  constructor(private db: Db) {}

  async download(bucket: Bucket, path: string): Promise<{ base64: string; mimeType: string; bytes: number }> {
    const { data, error } = await this.db.storage.from(bucket).download(path);
    if (error || !data) throw new AppError(404, 'file_not_found', `Imagem não encontrada: ${path}`);
    const buf = new Uint8Array(await data.arrayBuffer());
    const mimeType = data.type && data.type.startsWith('image/') ? data.type : sniffMime(buf);
    return { base64: bytesToBase64(buf), mimeType, bytes: buf.byteLength };
  }

  /** Like download, but returns null for images too large to send inline to a model. */
  async downloadForModel(bucket: Bucket, path: string) {
    const img = await this.download(bucket, path);
    return img.bytes > MAX_INLINE_IMAGE_BYTES ? null : img;
  }

  async exists(bucket: Bucket, path: string): Promise<boolean> {
    const dir = path.split('/').slice(0, -1).join('/');
    const name = path.split('/').pop()!;
    const { data } = await this.db.storage.from(bucket).list(dir, { search: name, limit: 1 });
    return Boolean(data?.some((f) => f.name === name));
  }

  async remove(bucket: Bucket, paths: string[]) {
    if (paths.length) await this.db.storage.from(bucket).remove(paths);
  }

  /** Deletes every object under a prefix (used for account deletion). */
  async removeFolder(bucket: Bucket, prefix: string) {
    const queue = [prefix];
    while (queue.length) {
      const dir = queue.shift()!;
      for (;;) {
        const { data } = await this.db.storage.from(bucket).list(dir, { limit: 100 });
        if (!data?.length) break;
        const files = data.filter((f) => f.id).map((f) => `${dir}/${f.name}`);
        data.filter((f) => !f.id).forEach((f) => queue.push(`${dir}/${f.name}`));
        if (!files.length) break;
        await this.db.storage.from(bucket).remove(files);
        if (data.length < 100) break;
      }
    }
  }
}

function sniffMime(b: Uint8Array): string {
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) return 'image/webp';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  return 'image/jpeg';
}

/** Portable base64 (Node and Deno have btoa; Buffer is Node-only). */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(out);
}
