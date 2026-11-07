import type { Db } from '../../lib/db';
import type { Logger } from '../../lib/log';
import { generateVapidKeys, sendWebPush, type VapidKeys } from '../../lib/webpush';

export interface PushMessage {
  title: string;
  body: string;
  /** Path inside the app, e.g. "/chat/<id>". */
  url: string;
  icon?: string | null;
  image?: string | null;
  tag?: string;
}

/** Browser push (Web Push + VAPID). Keys are created on first use and kept in private.settings. */
export class PushService {
  private keys: VapidKeys | null = null;

  constructor(
    private db: Db,
    private log: Logger,
    private opts: { subject?: string; fetch?: typeof fetch } = {},
  ) {}

  async vapid(): Promise<VapidKeys> {
    if (this.keys) return this.keys;
    const read = async () => {
      const { data } = await this.db.rpc('vapid_keys');
      const row = (Array.isArray(data) ? data[0] : data) as { public_key: string | null; private_jwk: string | null } | null;
      return row?.public_key && row.private_jwk ? { publicKey: row.public_key, privateJwk: row.private_jwk } : null;
    };
    let keys = await read();
    if (!keys) {
      const fresh = await generateVapidKeys();
      await this.db.rpc('store_vapid_keys', { p_public: fresh.publicKey, p_private: fresh.privateJwk });
      keys = (await read()) ?? fresh;
    }
    this.keys = keys;
    return keys;
  }

  async subscribe(userId: string, sub: { endpoint: string; keys: { p256dh: string; auth: string } }, userAgent: string) {
    await this.db
      .from('push_subscriptions')
      .upsert({ user_id: userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, user_agent: userAgent.slice(0, 300) }, { onConflict: 'endpoint' });
  }

  async unsubscribe(userId: string, endpoint: string) {
    await this.db.from('push_subscriptions').delete().eq('user_id', userId).eq('endpoint', endpoint);
  }

  /** Sends to every device of the user; drops subscriptions the browser revoked. Returns how many were delivered. */
  async sendToUser(userId: string, msg: PushMessage): Promise<number> {
    const { data } = await this.db.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', userId).limit(10);
    const subs = (data ?? []) as { id: string; endpoint: string; p256dh: string; auth: string }[];
    if (!subs.length) return 0;
    const keys = await this.vapid();
    let delivered = 0;
    for (const s of subs) {
      try {
        const status = await sendWebPush(s, msg, keys, { subject: this.opts.subject, fetch: this.opts.fetch });
        if (status === 404 || status === 410) await this.db.from('push_subscriptions').delete().eq('id', s.id);
        else if (status >= 200 && status < 300) {
          delivered++;
          await this.db.from('push_subscriptions').update({ last_used_at: new Date().toISOString() }).eq('id', s.id);
        } else this.log.warn({ status }, 'push rejected');
      } catch (e) {
        this.log.warn({ err: (e as Error).message }, 'push failed');
      }
    }
    return delivered;
  }
}
