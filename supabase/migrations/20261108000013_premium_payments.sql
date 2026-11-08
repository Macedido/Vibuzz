-- Vibuzz Premium: payments (Mercado Pago: Pix, cartão, boleto) and a public Premium badge.

-- Public badge (only the server writes it; profiles have no client update grant).
alter table public.user_profiles add column if not exists premium_until timestamptz;

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  provider text not null default 'mercadopago' check (char_length(provider) <= 30),
  provider_payment_id text not null check (char_length(provider_payment_id) <= 80),
  plan text not null check (plan in ('month', 'year')),
  amount numeric(10, 2) not null check (amount >= 0),
  currency text not null default 'BRL' check (char_length(currency) = 3),
  status text not null check (char_length(status) <= 30),
  created_at timestamptz not null default now(),
  unique (provider, provider_payment_id)
);
create index if not exists payments_user_idx on public.payments (user_id, created_at desc);
alter table public.payments enable row level security;
create policy payments_owner_read on public.payments for select to authenticated using (user_id = auth.uid());
grant select on public.payments to authenticated;

-- Grants Premium once per approved payment (calling it twice for the same payment is a no-op).
create or replace function public.apply_premium_payment(
  p_user uuid,
  p_provider text,
  p_payment_id text,
  p_plan text,
  p_amount numeric,
  p_currency text default 'BRL'
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days integer := case p_plan when 'month' then 30 when 'year' then 365 end;
  v_until timestamptz;
begin
  if v_days is null then raise exception 'invalid_plan' using errcode = 'P0001'; end if;
  insert into public.payments (user_id, provider, provider_payment_id, plan, amount, currency, status)
  values (p_user, p_provider, p_payment_id, p_plan, p_amount, upper(p_currency), 'approved')
  on conflict (provider, provider_payment_id) do nothing;
  if not found then
    select premium_until into v_until from public.users where id = p_user;
    return v_until;
  end if;

  update public.users
     set plan = 'premium',
         premium_until = greatest(coalesce(premium_until, now()), now()) + make_interval(days => v_days),
         premium_waitlist = false
   where id = p_user
  returning premium_until into v_until;
  update public.user_profiles set premium_until = v_until where id = p_user;
  insert into public.notifications (user_id, type, payload)
  values (p_user, 'system', jsonb_build_object(
    'title', 'Premium ativado!',
    'body', 'Valeu pelo apoio. Seu Premium vale até ' || to_char(v_until at time zone 'America/Sao_Paulo', 'DD/MM/YYYY') || '.'));
  return v_until;
end;
$$;
revoke all on function public.apply_premium_payment(uuid, text, text, text, numeric, text) from public, anon, authenticated;
grant execute on function public.apply_premium_payment(uuid, text, text, text, numeric, text) to service_role;

-- Accounts made Premium by hand keep their badge in sync.
update public.user_profiles p set premium_until = u.premium_until
from public.users u
where u.id = p.id and u.plan = 'premium' and u.premium_until is not null;
