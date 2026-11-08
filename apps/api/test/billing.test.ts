import { describe, expect, it, vi } from 'vitest';
import { BillingService, parseReference, validSignature } from '../src/modules/billing/service';

const USER = '11111111-1111-4111-8111-111111111111';

function setup(payment: Record<string, unknown>, rpc = vi.fn(async () => ({ data: '2026-12-08T00:00:00Z', error: null }))) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith('/checkout/preferences')) return new Response(JSON.stringify({ id: 'pref-1', init_point: 'https://mp.test/checkout?pref=1' }), { status: 201 });
    return new Response(JSON.stringify(payment), { status: 200 });
  }) as unknown as typeof fetch;
  const db = { rpc } as never;
  const billing = new BillingService(db, {
    accessToken: 'APP_USR-test',
    prices: { month: 14.9, year: 149 },
    appUrl: 'https://site.test/Vibuzz',
    apiUrl: 'https://api.test/fn',
    fetch: fetchMock,
  });
  return { billing, calls, rpc };
}

describe('billing', () => {
  it('parses our external reference and nothing else', () => {
    expect(parseReference(`${USER}|month`)).toEqual({ userId: USER, plan: 'month' });
    expect(parseReference(`${USER}|lifetime`)).toBeNull();
    expect(parseReference('abc|month')).toBeNull();
    expect(parseReference(null)).toBeNull();
  });

  it('creates a checkout with price, reference, return and webhook URLs', async () => {
    const { billing, calls } = setup({});
    const out = await billing.checkout(USER, 'year');
    expect(out.url).toBe('https://mp.test/checkout?pref=1');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.items[0]).toMatchObject({ unit_price: 149, currency_id: 'BRL', quantity: 1 });
    expect(body.external_reference).toBe(`${USER}|year`);
    expect(body.back_urls.success).toBe('https://site.test/Vibuzz/premium');
    expect(body.notification_url).toBe('https://api.test/fn/v1/billing/webhook');
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer APP_USR-test');
  });

  it('grants Premium only for approved payments in BRL', async () => {
    const ok = setup({ id: 99, status: 'approved', external_reference: `${USER}|month`, transaction_amount: 14.9, currency_id: 'BRL' });
    expect(await ok.billing.process('99')).toMatchObject({ status: 'approved', userId: USER, plan: 'month' });
    expect(ok.rpc).toHaveBeenCalledWith('apply_premium_payment', expect.objectContaining({ p_user: USER, p_payment_id: '99', p_plan: 'month' }));

    const pending = setup({ id: 98, status: 'pending', external_reference: `${USER}|month`, transaction_amount: 14.9, currency_id: 'BRL' });
    expect((await pending.billing.process('98')).status).toBe('pending');
    expect(pending.rpc).not.toHaveBeenCalled();

    const cheap = setup({ id: 97, status: 'approved', external_reference: `${USER}|year`, transaction_amount: 1, currency_id: 'BRL' });
    expect((await cheap.billing.process('97')).status).toBe('ignored');
    expect(cheap.rpc).not.toHaveBeenCalled();

    const foreign = setup({ id: 96, status: 'approved', external_reference: 'pedido-123', transaction_amount: 14.9 });
    expect((await foreign.billing.process('96')).status).toBe('ignored');
  });

  it('refuses to confirm a payment of another account', async () => {
    const other = setup({ id: 95, status: 'approved', external_reference: `${USER}|month`, transaction_amount: 14.9, currency_id: 'BRL' });
    await expect(other.billing.process('95', '22222222-2222-4222-8222-222222222222')).rejects.toThrow('outra conta');
    expect(other.rpc).not.toHaveBeenCalled();
  });

  it('reads payment ids from webhooks and IPN', () => {
    expect(BillingService.paymentIdFrom({}, { type: 'payment', data: { id: '123' } })).toBe('123');
    expect(BillingService.paymentIdFrom({ 'data.id': '456', type: 'payment' }, null)).toBe('456');
    expect(BillingService.paymentIdFrom({ id: '789', topic: 'payment' }, null)).toBe('789');
    expect(BillingService.paymentIdFrom({ id: '1', topic: 'merchant_order' }, null)).toBeNull();
    expect(BillingService.paymentIdFrom({}, { type: 'payment', data: { id: '1; drop' } })).toBeNull();
  });

  it('checks Mercado Pago signatures', async () => {
    const secret = 's3cret';
    const manifest = 'id:123;request-id:req-1;ts:1700000000;';
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const hex = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(manifest)))].map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(await validSignature(secret, `ts=1700000000,v1=${hex}`, 'req-1', '123')).toBe(true);
    expect(await validSignature(secret, `ts=1700000000,v1=${hex}`, 'req-2', '123')).toBe(false);
    expect(await validSignature(secret, undefined, 'req-1', '123')).toBe(false);
  });

  it('is off without a token', () => {
    const b = new BillingService({} as never, { prices: { month: 1, year: 2 }, appUrl: 'https://a.test', apiUrl: 'https://b.test' });
    expect(b.info()).toEqual({ enabled: false, currency: 'BRL', prices: { month: 1, year: 2 } });
  });
});
