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

// DeltaGuard is a phone app. If the bundle is ever loaded for web (pressing
// "w" in the Expo terminal, or opening localhost:8081 in a browser), there is
// no secure store: keep the session in memory only, and never persist it to
// browser storage.
const isNative = Platform.OS === 'ios' || Platform.OS === 'android';

export const supabase = createClient<Database>(env.url, env.anonKey, {
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
