import { isOfflineError, isSessionError } from '@deltaguard/shared';
import {
  focusManager,
  MutationCache,
  onlineManager,
  QueryCache,
  QueryClient,
} from '@tanstack/react-query';
import * as Network from 'expo-network';
import { AppState } from 'react-native';

import { isOfflineState } from './network';
import { supabase } from './supabase';

/**
 * A request that went out with an expired sign-in (common right after the
 * phone was offline: the token couldn't be renewed) fails as "permission
 * denied" or "JWT expired". Renew the session once so the next try works.
 * At most one renewal at a time.
 */
let renewing: Promise<unknown> | null = null;
function renewSession(error: unknown) {
  if (!isSessionError(error) || renewing) return;
  renewing = supabase.auth.refreshSession().finally(() => {
    renewing = null;
  });
}

/**
 * One React Query cache for the app. It is cleared on sign-out (see
 * session.tsx) so nothing from one officer is ever shown to the next person
 * who signs in on the phone.
 */
export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: renewSession }),
  mutationCache: new MutationCache({ onError: renewSession }),
  defaultOptions: {
    queries: {
      // Details, licences and sites change rarely; refetch at most every minute
      // when a screen opens or the app comes back to the foreground.
      staleTime: 60_000,
      // Once more after renewing an expired sign-in or a dropped connection;
      // other failures (not allowed, bad data) won't fix themselves.
      retry: (failureCount, error) =>
        failureCount < 2 && (isSessionError(error) || isOfflineError(error)),
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    },
  },
});

// Tell React Query when the phone has no connection: loads wait (keeping what's
// on screen) instead of failing, and everything refreshes when it's back. Only
// "no connection at all" counts (see network.ts).
onlineManager.setEventListener((setOnline) => {
  const subscription = Network.addNetworkStateListener((state) => {
    setOnline(!isOfflineState(state));
  });
  return () => subscription.remove();
});

// React Native has no window focus event: treat "app came to the foreground"
// as focus, so stale data refreshes when an officer reopens the app.
focusManager.setEventListener((setFocused) => {
  const subscription = AppState.addEventListener('change', (state) => {
    setFocused(state === 'active');
  });
  return () => subscription.remove();
});
