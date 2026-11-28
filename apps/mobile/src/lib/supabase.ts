import { parseSupabasePublicEnv, type Database } from '@deltaguard/shared';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import { secureStorage } from './secure-storage';

// Expo inlines EXPO_PUBLIC_ variables at bundle time, which only works with
// full dot notation (process.env.EXPO_PUBLIC_X), not destructuring.
const env = parseSupabasePublicEnv({
  url: process.env.EXPO_PUBLIC_SUPABASE_URL,
  anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
});

// Release builds talk to Supabase over HTTPS only (Android also refuses
// cleartext traffic at the OS level: expo-build-properties in app.json; iOS
// App Transport Security does the same by default). Plain HTTP is allowed only
// in development, for a local Supabase on the LAN.
if (!__DEV__ && !env.url.startsWith('https://')) {
  throw new Error('EXPO_PUBLIC_SUPABASE_URL must use https:// in release builds.');
}

// DeltaGuard is a phone app. If the bundle is ever loaded for web (pressing
// "w" in the Expo terminal, or opening localhost:8081 in a browser), there is
// no secure store: keep the session in memory only, and never persist it to
// browser storage.
const isNative = Platform.OS === 'ios' || Platform.OS === 'android';

/**
 * A request with no answer after this long fails (as "timed out", which the app
 * treats like being offline: Retry button, clock-in queued) instead of
 * spinning forever on a bad connection. Storage (photo uploads/downloads) and
 * Edge Functions get longer.
 */
const REQUEST_TIMEOUT_MS = 30_000;
const STORAGE_TIMEOUT_MS = 120_000;
/** Edge Functions that do real work (e.g. building a filled PDF). */
const FUNCTION_TIMEOUT_MS = 90_000;

const fetchWithTimeout: typeof fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const ms = url.includes('/storage/v1/')
    ? STORAGE_TIMEOUT_MS
    : url.includes('/functions/v1/')
      ? FUNCTION_TIMEOUT_MS
      : REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Request timed out')), ms);
  // Keep the caller's own cancel (e.g. the clock-in's abortSignal) working.
  const outer = init?.signal;
  if (outer) {
    if (outer.aborted) controller.abort(outer.reason);
    else outer.addEventListener('abort', () => controller.abort(outer.reason), { once: true });
  }
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
};

export const supabase = createClient<Database>(env.url, env.anonKey, {
  global: { fetch: fetchWithTimeout },
  auth: {
    storage: isNative ? secureStorage : undefined,
    autoRefreshToken: isNative,
    persistSession: isNative,
    // Native apps have no browser URL bar; OAuth/magic-link callbacks arrive via deep links instead.
    detectSessionInUrl: false,
  },
});

// Mobile OSes suspend backgrounded apps, which breaks supabase-js's refresh
// timer. Only refresh the token while the app is in the foreground.
if (isNative) {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
