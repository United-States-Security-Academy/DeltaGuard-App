import type { AuthLinkParams } from '@deltaguard/shared';
import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';

import { type AccessResult, type Profile, verifyAccess } from './access';
import { authenticateOwner, type UnlockResult } from './biometric';
import { supabase } from './supabase';

/** Lock again after this long in the background. */
const LOCK_AFTER_MS = 5 * 60 * 1000;

export type SessionState =
  | { status: 'loading' }
  | { status: 'signedOut'; notice?: string }
  | { status: 'unreachable'; message: string; userId: string; allowRegister: boolean }
  | { status: 'ready'; profile: Profile; email: string | undefined };

type SessionContextValue = {
  state: SessionState;
  /** True while the biometric lock screen should cover the app. */
  locked: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: (notice?: string) => Promise<void>;
  unlock: () => Promise<UnlockResult>;
  retry: () => Promise<void>;
  /** Invite link step 1: exchange the one-time token for a session. */
  acceptInvite: (params: AuthLinkParams) => Promise<string | null>;
  /** Invite link step 2: save the password, then register this phone. */
  setPassword: (password: string) => Promise<string | null>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession() {
  const value = use(SessionContext);
  if (!value) throw new Error('useSession must be used inside <SessionProvider>');
  return value;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading' });
  const [locked, setLocked] = useState(false);
  // Event listeners need the latest state without re-subscribing.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const backgroundedAt = useRef<number | null>(null);

  const signOut = useCallback(async (notice?: string) => {
    // 'local' ends this phone's session only (not the officer's other sessions).
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
    setLocked(false);
    setState({ status: 'signedOut', notice });
  }, []);

  const applyAccess = useCallback(
    async (result: AccessResult, userId: string, allowRegister: boolean) => {
      if (result.ok) {
        const { data } = await supabase.auth.getSession();
        setState({ status: 'ready', profile: result.profile, email: data.session?.user.email });
      } else if (result.kind === 'denied') {
        await signOut(result.message);
      } else {
        setState({ status: 'unreachable', message: result.message, userId, allowRegister });
      }
    },
    [signOut],
  );

  const enter = useCallback(
    async (userId: string, allowRegister: boolean) => {
      await applyAccess(await verifyAccess(userId, allowRegister), userId, allowRegister);
    },
    [applyAccess],
  );

  // Launch: restore the session from secure storage, lock, check access.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!data.session) {
        setState({ status: 'signedOut' });
        return;
      }
      setLocked(true); // every app open needs biometric unlock
      await enter(data.session.user.id, false);
    })();

    // Signed out elsewhere (e.g. an admin suspended the account, so the
    // refresh token stopped working). Don't call Supabase inside this
    // callback: it can deadlock the auth client.
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT' && stateRef.current.status === 'ready') {
        setLocked(false);
        setState({ status: 'signedOut', notice: 'You have been signed out. Sign in again.' });
      }
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, [enter]);

  // Lock after 5 minutes in the background. Only 'background' counts:
  // iOS reports 'inactive' while the Face ID prompt itself is showing.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'background') {
        backgroundedAt.current = Date.now();
      } else if (next === 'active' && backgroundedAt.current !== null) {
        const away = Date.now() - backgroundedAt.current;
        backgroundedAt.current = null;
        if (away >= LOCK_AFTER_MS && stateRef.current.status === 'ready') setLocked(true);
      }
    });
    return () => subscription.remove();
  }, []);

  const unlock = useCallback(async (): Promise<UnlockResult> => {
    const result = await authenticateOwner();
    if (!result.ok) return result;
    setLocked(false);

    // Re-check in the background: they may have been suspended or had their
    // device reset while the app was locked.
    const current = stateRef.current;
    if (current.status === 'ready') {
      const access = await verifyAccess(current.profile.id, false);
      if (!access.ok && access.kind === 'denied') await signOut(access.message);
    }
    return result;
  }, [signOut]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error || !data.user) return 'Incorrect email or password.';
      // They just proved who they are with a password: no biometric prompt.
      await enter(data.user.id, true);
      return null;
    },
    [enter],
  );

  const acceptInvite = useCallback(async (params: AuthLinkParams) => {
    const { error } = await supabase.auth.verifyOtp(params);
    return error
      ? 'This link is invalid or has expired. Ask an admin to resend your invite.'
      : null;
  }, []);

  const setPassword = useCallback(
    async (password: string) => {
      const { data, error } = await supabase.auth.updateUser({ password });
      if (error || !data.user) return error?.message ?? 'Could not save your password.';
      await enter(data.user.id, true);
      return null;
    },
    [enter],
  );

  const retry = useCallback(async () => {
    const current = stateRef.current;
    if (current.status !== 'unreachable') return;
    setState({ status: 'loading' });
    await enter(current.userId, current.allowRegister);
  }, [enter]);

  const value = useMemo<SessionContextValue>(
    () => ({ state, locked, signIn, signOut, unlock, retry, acceptInvite, setPassword }),
    [state, locked, signIn, signOut, unlock, retry, acceptInvite, setPassword],
  );

  return <SessionContext value={value}>{children}</SessionContext>;
}
