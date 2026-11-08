import type { BillingInfo, BillingPlan } from '@vibuzz/shared';
import type { Db } from '../../lib/db';
import { AppError, forbidden } from '../../lib/errors';

const MP_API = 'https://api.mercadopago.com';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface BillingOptions {
  accessToken?: string;
  webhookSecret?: string;
  prices: Record<BillingPlan, number>;
  appUrl: string;
  apiUrl: string;
  fetch?: typeof fetch;
}

interface MpPayment {
  id: number | string;
  status: string;
  external_reference?: string | null;
  transaction_amount?: number;
  currency_id?: string;
}

export type PaymentOutcome =
  | { status: 'approved'; userId: string; plan: BillingPlan; premiumUntil: string | null }
  | { status: 'pending' | 'rejected' | 'ignored'; userId?: string };

/** "<userId>|<plan>" written by us into the preference, read back from the payment. */
export function parseReference(ref: string | null | undefined): { userId: string; plan: BillingPlan } | null {
  const [userId, plan] = String(ref ?? '').split('|');
  if (!UUID.test(userId ?? '') || (plan !== 'month' && plan !== 'year')) return null;
  return { userId, plan };
}

/** Mercado Pago "x-signature" check: HMAC-SHA256 of "id:<data.id>;request-id:<x-request-id>;ts:<ts>;". */
export async function validSignature(secret: string, header: string | undefined, requestId: string | undefined, dataId: string): Promise<boolean> {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=') as [string, string]));
  if (!parts.ts || !parts.v1) return false;
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId ?? ''};ts:${parts.ts};`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(manifest)));
  const hex = [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex === parts.v1.toLowerCase();
}

/**
 * Premium sold through Mercado Pago Checkout Pro (Pix, cartão e boleto).
 * One-off passes (30 or 365 days) that stack; access is granted only after the
 * payment is fetched back from Mercado Pago with our token and is "approved".
 */
export class BillingService {
  constructor(
    private db: Db,
    private opts: BillingOptions,
  ) {}

  get enabled(): boolean {
    return Boolean(this.opts.accessToken);
  }

  info(): BillingInfo {
    return { enabled: this.enabled, currency: 'BRL', prices: this.opts.prices };
  }

  private async mp<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    if (!this.opts.accessToken) throw new AppError(503, 'billing_disabled', 'As vendas do Premium ainda não foram ativadas.');
    const res = await (this.opts.fetch ?? fetch)(`${MP_API}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Bearer ${this.opts.accessToken}`,
        'content-type': 'application/json',
        ...(init.method === 'POST' ? { 'x-idempotency-key': crypto.randomUUID() } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new AppError(502, 'billing_failed', `Mercado Pago recusou o pedido (${res.status}). ${text.slice(0, 160)}`.trim());
    }
    return (await res.json()) as T;
  }

  /** Creates a Checkout Pro preference and returns the payment page URL. */
  async checkout(userId: string, plan: BillingPlan, email?: string | null): Promise<{ url: string; preferenceId: string }> {
    const price = this.opts.prices[plan];
    const title = plan === 'year' ? 'Vibuzz Premium — 12 meses' : 'Vibuzz Premium — 1 mês';
    const back = `${this.opts.appUrl.replace(/\/$/, '')}/premium`;
    const pref = await this.mp<{ id: string; init_point: string }>('/checkout/preferences', {
      method: 'POST',
      body: {
        items: [{ id: `premium-${plan}`, title, description: 'Mais mensagens, memória, fotos e respostas mais rápidas no Vibuzz.', quantity: 1, unit_price: price, currency_id: 'BRL' }],
        external_reference: `${userId}|${plan}`,
        ...(email ? { payer: { email } } : {}),
        back_urls: { success: back, pending: back, failure: back },
        auto_return: 'approved',
        notification_url: `${this.opts.apiUrl.replace(/\/$/, '')}/v1/billing/webhook`,
        statement_descriptor: 'VIBUZZ',
        payment_methods: { installments: plan === 'year' ? 6 : 1 },
      },
    });
    return { url: pref.init_point, preferenceId: pref.id };
  }

  /** Fetches the payment from Mercado Pago and grants Premium when it is approved. */
  async process(paymentId: string, expectedUser?: string): Promise<PaymentOutcome> {
    const p = await this.mp<MpPayment>(`/v1/payments/${encodeURIComponent(paymentId)}`);
    const ref = parseReference(p.external_reference);
    if (!ref) return { status: 'ignored' };
    if (expectedUser && ref.userId !== expectedUser) throw forbidden('Este pagamento é de outra conta.');
    if (p.status !== 'approved') return { status: p.status === 'rejected' || p.status === 'cancelled' ? 'rejected' : 'pending', userId: ref.userId };
    const amount = Number(p.transaction_amount ?? 0);
    if ((p.currency_id ?? 'BRL') !== 'BRL' || amount + 0.01 < this.opts.prices[ref.plan] * 0.5) return { status: 'ignored', userId: ref.userId };
    const { data, error } = await this.db.rpc('apply_premium_payment', {
      p_user: ref.userId,
      p_provider: 'mercadopago',
      p_payment_id: String(p.id),
      p_plan: ref.plan,
      p_amount: amount,
      p_currency: 'BRL',
    });
    if (error) throw new AppError(500, 'billing_apply_failed', 'Pagamento aprovado, mas não consegui ativar o Premium. Fale com o suporte.');
    return { status: 'approved', userId: ref.userId, plan: ref.plan, premiumUntil: (data as string | null) ?? null };
  }

  /** Webhook body/query → payment id (new Webhooks and old IPN formats). */
  static paymentIdFrom(query: Record<string, string | undefined>, body: unknown): string | null {
    const b = (body ?? {}) as { type?: string; topic?: string; action?: string; data?: { id?: string | number } };
    const type = b.type ?? b.topic ?? query.type ?? query.topic;
    if (type && type !== 'payment') return null;
    const id = b.data?.id ?? query['data.id'] ?? query.id;
    return id != null && /^\d{1,20}$/.test(String(id)) ? String(id) : null;
  }

  async verifyWebhook(headers: { signature?: string; requestId?: string }, dataId: string): Promise<boolean> {
    if (!this.opts.webhookSecret) return true;
    return validSignature(this.opts.webhookSecret, headers.signature, headers.requestId, dataId);
  }
}
