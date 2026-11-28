// Test harness: a fake Supabase that records every data access, and the
// signed-in user to pretend to be. Imported by tests AFTER their vi.mock()s.

export type FakeClaims = {
  sub: string;
  email?: string;
  user_role?: string;
  employment_status?: string;
  aal?: string;
  amr?: { method: string; timestamp: number }[];
};

export const state: {
  claims: FakeClaims | null;
  profile: { role: string; employment_status: string } | null;
  /** Every data access (table, RPC, storage, Auth admin): must stay empty when access is refused. */
  calls: string[];
} = { claims: null, profile: null, calls: [] };

const now = () => Math.floor(Date.now() / 1000);

/** Sets who is "signed in". `mfaMinutesAgo` = when TOTP was last entered. */
export function signInAs(
  who: 'nobody' | 'officer' | 'supervisor' | 'admin',
  opts: {
    aal?: 'aal1' | 'aal2';
    liveStatus?: string;
    liveRole?: string;
    signedInHoursAgo?: number;
    mfaMinutesAgo?: number;
  } = {},
) {
  state.calls = [];
  if (who === 'nobody') {
    state.claims = null;
    state.profile = null;
    return;
  }
  const signedIn = now() - (opts.signedInHoursAgo ?? 1) * 3600;
  state.claims = {
    sub: '00000000-0000-4000-8000-000000000001',
    email: `${who}@test.local`,
    user_role: who,
    employment_status: 'active',
    aal: opts.aal ?? 'aal2',
    amr: [
      { method: 'password', timestamp: signedIn },
      { method: 'totp', timestamp: now() - (opts.mfaMinutesAgo ?? 1) * 60 },
    ],
  };
  state.profile = { role: opts.liveRole ?? who, employment_status: opts.liveStatus ?? 'active' };
}

const BLOCKED = { data: null, error: { code: 'TEST', message: 'blocked in test' }, count: 0 };

/** A query builder: any chain of calls; recorded as data access when it runs. */
function query(table: string): unknown {
  let columns = '';
  const isAuthCheck = () => table === 'profiles' && columns === 'role, employment_status';
  const run = () => {
    if (isAuthCheck()) return Promise.resolve({ data: state.profile, error: null });
    state.calls.push(`from:${table}`);
    return Promise.resolve(BLOCKED);
  };
  const builder: Record<string | symbol, unknown> = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
            run().then(resolve, reject);
        }
        if (prop === 'maybeSingle' || prop === 'single') return () => run();
        return (...args: unknown[]) => {
          if (prop === 'select' && typeof args[0] === 'string') columns = args[0];
          return builder;
        };
      },
    },
  );
  return builder;
}

/** Anything not modelled: calling it is recorded as data access. */
function recorder(label: string): unknown {
  return new Proxy(() => undefined, {
    get(_t, prop) {
      if (prop === 'then') return undefined;
      return recorder(`${label}.${String(prop)}`);
    },
    apply() {
      state.calls.push(label);
      return Promise.resolve(BLOCKED);
    },
  });
}

export function fakeServerClient() {
  return {
    auth: {
      getClaims: async () => ({
        data: state.claims ? { claims: state.claims } : null,
        error: state.claims ? null : { message: 'no session' },
      }),
      getUser: async () => ({
        data: { user: state.claims ? { id: state.claims.sub } : null },
        error: null,
      }),
      getSession: async () => ({ data: { session: null }, error: null }),
      signOut: async () => ({ error: null }),
      mfa: recorder('auth.mfa'),
      admin: recorder('auth.admin'),
      signInWithPassword: recorder('auth.signInWithPassword'),
      updateUser: recorder('auth.updateUser'),
      verifyOtp: recorder('auth.verifyOtp'),
    },
    from: (table: string) => query(table),
    rpc: (name: string) => {
      state.calls.push(`rpc:${name}`);
      return Promise.resolve(BLOCKED);
    },
    storage: recorder('storage'),
  };
}

export function fakeAdminClient() {
  return recorder('service-role');
}

/** The redirect target if `error` is Next's redirect, else null. */
export function redirectTarget(error: unknown): string | null {
  const digest = (error as { digest?: unknown })?.digest;
  if (typeof digest !== 'string' || !digest.startsWith('NEXT_REDIRECT')) return null;
  return digest.split(';')[2] ?? null;
}

/** Runs an action and reports how it ended. */
export async function outcome(
  run: () => unknown,
): Promise<{ redirect: string | null; result: unknown; threw: unknown }> {
  try {
    const result = await run();
    return { redirect: null, result, threw: null };
  } catch (error) {
    return { redirect: redirectTarget(error), result: null, threw: error };
  }
}
