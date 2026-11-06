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
    const buf = Buffer.from(await data.arrayBuffer());
    const mimeType = data.type && data.type.startsWith('image/') ? data.type : sniffMime(buf);
    return { base64: buf.toString('base64'), mimeType, bytes: buf.byteLength };
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

function sniffMime(buf: Buffer): string {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.subarray(0, 4).toString() === 'RIFF') return 'image/webp';
  if (buf.subarray(0, 3).toString() === 'GIF') return 'image/gif';
  return 'image/jpeg';
}
