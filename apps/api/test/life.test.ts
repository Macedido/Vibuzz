import { describe, expect, it } from 'vitest';
import { b64url, encryptPayload, fromB64url, generateVapidKeys, vapidAuthorization } from '../src/lib/webpush';
import { idleText } from '../src/modules/life/service';
import { extractPhoto } from '../src/modules/intelligence/prompts';
import { PushService } from '../src/modules/push/service';
import { silentLogger } from '../src/lib/log';

describe('photos in replies', () => {
  it('splits the photo line from the visible text', () => {
    const out = extractPhoto('*sorri e tira uma selfie* Olha onde eu tô!\n[foto: selfie of a fox girl at a snowy Christmas fair, warm lights]');
    expect(out.text).toBe('*sorri e tira uma selfie* Olha onde eu tô!');
    expect(out.photo).toBe('selfie of a fox girl at a snowy Christmas fair, warm lights');
    expect(extractPhoto('Sem foto aqui.').photo).toBeNull();
  });
});

describe('life of its own', () => {
  it('describes how long the user was away', () => {
    const now = new Date('2026-11-07T20:00:00Z');
    expect(idleText('2026-11-07T19:10:00Z', now)).toBe('cerca de uma hora');
    expect(idleText('2026-11-07T14:00:00Z', now)).toBe('umas 6 horas');
    expect(idleText('2026-11-06T18:00:00Z', now)).toBe('desde ontem');
    expect(idleText('2026-11-03T20:00:00Z', now)).toBe('4 dias');
  });
});

describe('web push', () => {
  it('signs VAPID headers with the public key attached', async () => {
    const keys = await generateVapidKeys();
    expect(fromB64url(keys.publicKey).length).toBe(65);
    const h = await vapidAuthorization('https://updates.push.services.mozilla.com/wpush/v2/abc', keys, 'mailto:a@b.c');
    expect(h).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
  });

  it('builds an aes128gcm body (salt, record size, key, ciphertext)', async () => {
    const ua = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as { publicKey: any };
    const p256dh = b64url(new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey)));
    const body = await encryptPayload(new TextEncoder().encode('{"title":"oi"}'), { p256dh, auth: b64url(crypto.getRandomValues(new Uint8Array(16))) });
    expect(body.length).toBe(16 + 4 + 1 + 65 + 14 + 1 + 16);
    expect(body[20]).toBe(65);
  });

  it('drops subscriptions the browser revoked', async () => {
    const deleted: string[] = [];
    const subs = [{ id: 's1', endpoint: 'https://push.test/1', p256dh: '', auth: '' }];
    const ua = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as { publicKey: any };
    subs[0].p256dh = b64url(new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey)));
    subs[0].auth = b64url(crypto.getRandomValues(new Uint8Array(16)));
    const keys = await generateVapidKeys();
    const db = {
      rpc: async (name: string) => (name === 'vapid_keys' ? { data: [{ public_key: keys.publicKey, private_jwk: keys.privateJwk }] } : { data: null }),
      from: () => ({
        select: () => ({ eq: () => ({ limit: async () => ({ data: subs }) }) }),
        delete: () => ({ eq: async (_c: string, v: string) => (deleted.push(v), {}) }),
        update: () => ({ eq: async () => ({}) }),
      }),
    };
    const push = new PushService(db as never, silentLogger, { fetch: (async () => new Response(null, { status: 410 })) as unknown as typeof fetch });
    expect(await push.sendToUser('u', { title: 'Lyra', body: 'oi', url: '/chat/1' })).toBe(0);
    expect(deleted).toEqual(['s1']);
  });
});
