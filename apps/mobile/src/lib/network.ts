import * as Network from 'expo-network';

// When does the app treat the phone as offline?
//
// Only when it has no connection at all (`isConnected === false`). Android's
// `isInternetReachable` is the OS's own "validated" check (a probe to Google
// servers). On some phones and networks it stays false while the internet
// works fine, and trusting it made every load wait forever (endless spinner)
// and every clock-in go to the offline queue. With a connection, the app just
// tries: a request that really can't get through fails (or times out, see
// supabase.ts) and is retried or queued.

export function isOfflineState(state: Network.NetworkState | null | undefined): boolean {
  return state?.isConnected === false;
}

/** Ask the OS now. Unknown counts as online: the request itself will tell. */
export async function looksOffline(): Promise<boolean> {
  const state = await Network.getNetworkStateAsync().catch(() => null);
  return isOfflineState(state);
}
