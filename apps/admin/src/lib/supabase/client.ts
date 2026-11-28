import type { Database } from '@deltaguard/shared';
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';

import { supabaseEnv } from './env';

// Supabase client for Client Components.
//
// The session cookies are httpOnly, so the browser never sees the refresh
// token. Requests (PostgREST, Storage, Realtime) use a short-lived access token
// fetched from this site's /auth/token, which only answers active staff who
// have passed MFA. Signing in, MFA and signing out happen on the server.

type Token = { accessToken: string; expiresAt: number };

let current: Token | null = null;
let inFlight: Promise<Token | null> | null = null;

async function fetchToken(): Promise<Token | null> {
  const res = await fetch('/auth/token', {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  }).catch(() => null);
  if (!res?.ok || !res.headers.get('content-type')?.includes('application/json')) return null;
  const body = (await res.json().catch(() => null)) as {
    access_token?: unknown;
    expires_at?: unknown;
  } | null;
  if (typeof body?.access_token !== 'string' || typeof body.expires_at !== 'number') return null;
  return { accessToken: body.access_token, expiresAt: body.expires_at };
}

/** The current access token, renewed a minute before it expires. */
async function accessToken(): Promise<string | null> {
  if (current && current.expiresAt - 60 > Date.now() / 1000) return current.accessToken;
  inFlight ??= fetchToken().finally(() => {
    inFlight = null;
  });
  current = await inFlight;
  return current?.accessToken ?? null;
}

/** Forget the cached token (e.g. after a request failed as signed out). */
export function invalidateAccessToken(): void {
  current = null;
}

let client: SupabaseClient<Database> | null = null;

export function createClient(): SupabaseClient<Database> {
  client ??= createSupabaseClient<Database>(supabaseEnv.url, supabaseEnv.anonKey, {
    accessToken,
  });
  return client;
}
