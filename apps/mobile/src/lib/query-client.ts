import { focusManager, QueryClient } from '@tanstack/react-query';
import { AppState } from 'react-native';

/**
 * One React Query cache for the app. It is cleared on sign-out (see
 * session.tsx) so nothing from one officer is ever shown to the next person
 * who signs in on the phone.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Details, licences and sites change rarely; refetch at most every minute
      // when a screen opens or the app comes back to the foreground.
      staleTime: 60_000,
      retry: 1,
    },
  },
});

// React Native has no window focus event: treat "app came to the foreground"
// as focus, so stale data refreshes when an officer reopens the app.
focusManager.setEventListener((setFocused) => {
  const subscription = AppState.addEventListener('change', (state) => {
    setFocused(state === 'active');
  });
  return () => subscription.remove();
});
