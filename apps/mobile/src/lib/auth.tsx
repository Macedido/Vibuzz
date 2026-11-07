import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from './supabase';

export interface Profile {
  id: string;
  username: string;
  display_name: string;
  bio: string;
  avatar_path: string | null;
  follower_count: number;
  following_count: number;
  character_count: number;
}

export interface Account {
  id: string;
  /** Null right after a Google sign-up, until the age step. */
  birthdate: string | null;
  allow_mature: boolean;
  spontaneous_messages: boolean;
  voice_enabled?: boolean;
  timezone?: string;
  plan?: 'free' | 'premium';
  premium_waitlist?: boolean;
  private_mode?: boolean;
  role: string;
  status: string;
}

interface AuthState {
  ready: boolean;
  session: Session | null;
  userId: string | null;
  profile: Profile | null;
  account: Account | null;
  isAdult: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function ageOf(birthdate: string): number {
  const b = new Date(birthdate + 'T00:00:00');
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [account, setAccount] = useState<Account | null>(null);

  const load = useCallback(async (s: Session | null) => {
    if (!s) {
      setProfile(null);
      setAccount(null);
      return;
    }
    const [p, a] = await Promise.all([
      supabase.from('user_profiles').select('*').eq('id', s.user.id).maybeSingle(),
      supabase.from('users').select('*').eq('id', s.user.id).maybeSingle(),
    ]);
    setProfile((p.data as Profile) ?? null);
    const acc = (a.data as Account) ?? null;
    setAccount(acc);
    // Spontaneous messages respect the user's waking hours: keep the timezone current.
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (acc && tz && acc.timezone !== tz) void supabase.from('users').update({ timezone: tz }).eq('id', acc.id);
  }, []);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      await load(data.session).catch(() => {});
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      void load(s).catch(() => {});
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [load]);

  const value = useMemo<AuthState>(
    () => ({
      ready,
      session,
      userId: session?.user.id ?? null,
      profile,
      account,
      isAdult: account?.birthdate ? ageOf(account.birthdate) >= 18 : false,
      refresh: () => load(session),
      signOut: async () => {
        await supabase.auth.signOut();
      },
    }),
    [ready, session, profile, account, load],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
