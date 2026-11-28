// Authorization of every server action and route handler in the console.
//
// Each one is imported and called as each kind of caller. A refused caller
// must be redirected (actions) or get 401/403 (routes) BEFORE any data access:
// the fake Supabase records every table, RPC, storage and Auth-admin call, and
// that list must stay empty. New actions must be added to the tables below;
// the "every action is classified" test fails until they are.
import type * as NextServer from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeAdminClient, fakeServerClient, outcome, signInAs, state } from './harness';

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => undefined }),
  headers: async () => new Headers(),
}));
vi.mock('next/cache', () => ({
  refresh: vi.fn(),
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
}));
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof NextServer>()),
  connection: async () => undefined,
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => fakeServerClient() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => fakeAdminClient() }));

// ---------------------------------------------------------------------------
// Every server action, by who may call it
// ---------------------------------------------------------------------------

const ADMIN_ONLY = new Set([
  'addClient',
  'updateClient',
  'deleteClient',
  'createFormTemplate',
  'attachFormPdf',
  'saveFormFields',
  'publishFormTemplate',
  'updateFormDetails',
  'setFormArchived',
  'deleteDraftForm',
  'createFormAssignment',
  'deleteFormAssignment',
  'saveOfficerDetails',
  'addQualification',
  'deleteQualification',
  'updateSettings',
  'createSite',
  'deleteSite',
  'assignOfficer',
  'unassignOfficer',
  'addSosContact',
  'toggleSosContact',
  'deleteSosContact',
  'createPayPeriod',
  'deletePayPeriod',
  'lockPayPeriod',
  'createLesson',
  'attachLessonPdf',
  'updateLessonDetails',
  'setLessonStatus',
  'deleteDraftLesson',
  'saveAssessmentSettings',
  'saveQuestion',
  'deleteQuestion',
  'reorderQuestions',
  'importQuestionsCsv',
  'createLessonAssignment',
  'deleteLessonAssignment',
  'grantExtraAttempt',
  'inviteUser',
  'changeRole',
  'setEmploymentStatus',
  'resetDevice',
  'pauseWelfareChecks',
  'resumeWelfareChecks',
  'saveSiteWelfare',
  'setCompanyWelfarePolicy',
  'createWelfarePolicy',
  'updateWelfarePolicy',
  'deleteWelfarePolicy',
  'setOfficerWelfare',
]);
const STAFF = new Set([
  'reviewFormSubmission',
  'reviewIncident',
  'checkShift',
  'createShift',
  'updateShift',
  'cancelShift',
  'updateSite',
  'createPostOrder',
  'updatePostOrder',
  'setPostOrderArchived',
  'approveEntries',
  'correctEntry',
  'reauthenticate',
]);
/** Before or outside a staff session, each with its own check (tested below). */
const PRE_AUTH = new Set(['signIn', 'signOut', 'setPassword', 'startMfa', 'verifyMfa']);
/** Need the authenticator code entered in the last few minutes. */
const SENSITIVE = ['changeRole', 'setEmploymentStatus', 'resetDevice'];

type Action = (...args: unknown[]) => Promise<unknown>;
const modules = import.meta.glob('../app/**/*actions.ts', { eager: true }) as Record<
  string,
  Record<string, unknown>
>;
const actions: [string, Action][] = Object.values(modules).flatMap((mod) =>
  Object.entries(mod)
    .filter(([, v]) => typeof v === 'function')
    .map(([name, fn]) => [name, fn as Action] as [string, Action]),
);
const protectedActions = actions.filter(([name]) => !PRE_AUTH.has(name));
const call = (fn: Action) => fn(null, new FormData());

beforeEach(() => signInAs('nobody'));

describe('server actions', () => {
  it('finds the actions', () => {
    expect(actions.length).toBeGreaterThan(60);
  });

  it('every action is classified (add new ones to ADMIN_ONLY / STAFF / PRE_AUTH)', () => {
    const unclassified = actions
      .map(([name]) => name)
      .filter((n) => !ADMIN_ONLY.has(n) && !STAFF.has(n) && !PRE_AUTH.has(n));
    expect(unclassified).toEqual([]);
  });

  const refused: [string, () => void, RegExp][] = [
    ['signed out', () => signInAs('nobody'), /^\/login\?error=not_allowed$/],
    ['an officer', () => signInAs('officer'), /^\/login\?error=not_allowed$/],
    ['staff without MFA (aal1)', () => signInAs('admin', { aal: 'aal1' }), /^\/login/],
    [
      'an admin suspended since the token was issued',
      () => signInAs('admin', { liveStatus: 'suspended' }),
      /^\/login\?error=not_allowed$/,
    ],
    [
      'an admin demoted since the token was issued',
      () => signInAs('admin', { liveRole: 'officer' }),
      /^\/login\?error=not_allowed$/,
    ],
    [
      'a session older than 12 hours',
      () => signInAs('admin', { signedInHoursAgo: 13 }),
      /^\/login\?error=expired$/,
    ],
  ];

  for (const [who, setup, target] of refused) {
    it.each(protectedActions)(`${who}: %s is refused before any data access`, async (_n, fn) => {
      setup();
      const r = await outcome(() => call(fn));
      expect(r.redirect).toMatch(target);
      expect(state.calls).toEqual([]);
    });
  }

  it.each(protectedActions.filter(([n]) => ADMIN_ONLY.has(n)))(
    'a supervisor: admin-only %s is refused before any data access',
    async (_n, fn) => {
      signInAs('supervisor');
      const r = await outcome(() => call(fn));
      expect(r.redirect).toBe('/');
      expect(state.calls).toEqual([]);
    },
  );

  it.each(protectedActions.filter(([n]) => STAFF.has(n)))(
    'a supervisor with MFA may call %s',
    async (_n, fn) => {
      signInAs('supervisor');
      const r = await outcome(() => call(fn));
      expect(r.redirect ?? '').not.toMatch(/^\/login/);
    },
  );

  it.each(protectedActions)('an admin with MFA may call %s', async (_n, fn) => {
    signInAs('admin');
    const r = await outcome(() => call(fn));
    expect(r.redirect ?? '').not.toMatch(/^\/login/);
  });

  it.each(SENSITIVE)(
    '%s asks for the authenticator code again when it was entered over 10 minutes ago',
    async (name) => {
      const fn = actions.find(([n]) => n === name)![1];
      signInAs('admin', { mfaMinutesAgo: 30 });
      const r = await outcome(() => call(fn));
      expect(r.result).toMatchObject({ ok: false, reauthUrl: '/reauth?next=%2Fusers' });
      expect(state.calls).toEqual([]);
    },
  );

  it.each(SENSITIVE)('%s goes ahead with a fresh code', async (name) => {
    const fn = actions.find(([n]) => n === name)![1];
    signInAs('admin', { mfaMinutesAgo: 2 });
    const r = await outcome(() => call(fn));
    expect((r.result as { reauthUrl?: string } | null)?.reauthUrl).toBeUndefined();
  });

  describe('pre-auth actions', () => {
    const get = (name: string) => actions.find(([n]) => n === name)![1];

    it.each(['signed out', 'officer'] as const)(
      'MFA setup refuses %s without touching factors',
      async (who) => {
        signInAs(who === 'signed out' ? 'nobody' : 'officer');
        expect(await get('startMfa')()).toMatchObject({ kind: 'error' });
        expect(
          await get('verifyMfa')('00000000-0000-4000-8000-000000000009', '123456'),
        ).toMatchObject({ ok: false });
        expect(state.calls).toEqual([]);
      },
    );

    it('setting a password needs a signed-in invitee', async () => {
      signInAs('nobody');
      const fd = new FormData();
      fd.set('password', 'a-long-password-1');
      fd.set('confirm', 'a-long-password-1');
      const r = await outcome(() => get('setPassword')(null, fd));
      expect(state.calls.filter((c) => c.startsWith('auth.updateUser'))).toEqual([]);
      expect(r.redirect ?? JSON.stringify(r.result)).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

type Handler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>;
const routeModules = import.meta.glob('../app/**/route.ts', { eager: true }) as Record<
  string,
  Record<string, unknown>
>;
/** Public by design: verifies an emailed token itself. */
const PUBLIC_ROUTES = ['auth/confirm/route.ts'];
const ID = '00000000-0000-4000-8000-0000000000aa';
const routes: [string, string, Handler][] = Object.entries(routeModules)
  .filter(([file]) => !PUBLIC_ROUTES.some((p) => file.endsWith(p)))
  .flatMap(([file, mod]) =>
    (['GET', 'POST'] as const)
      .filter((m) => typeof mod[m] === 'function')
      .map((m) => [file.replace('../app/', ''), m, mod[m] as Handler] as [string, string, Handler]),
  );

function request(file: string, method: string): Request {
  const headers = new Headers({ origin: 'http://localhost', host: 'localhost' });
  const init: RequestInit = { method, headers };
  if (method === 'POST') init.body = new FormData();
  return new Request(`http://localhost/${file}?format=csv`, init);
}
const context = () => ({ params: Promise.resolve({ id: ID, periodId: ID, attemptId: ID }) });

describe('route handlers', () => {
  it('finds the routes', () => {
    expect(routes.length).toBeGreaterThanOrEqual(9);
  });

  const refused: [string, () => void][] = [
    ['signed out', () => signInAs('nobody')],
    ['an officer', () => signInAs('officer')],
    ['staff without MFA', () => signInAs('supervisor', { aal: 'aal1' })],
    ['a suspended admin', () => signInAs('admin', { liveStatus: 'suspended' })],
    ['a session older than 12 hours', () => signInAs('admin', { signedInHoursAgo: 13 })],
  ];
  for (const [who, setup] of refused) {
    it.each(routes)(
      `${who}: %s %s is refused before any data access`,
      async (file, method, handler) => {
        setup();
        const res = await handler(request(file, method), context());
        expect([401, 403]).toContain(res.status);
        expect(state.calls).toEqual([]);
      },
    );
  }

  it('payroll export asks for the authenticator code again when it is stale', async () => {
    const [, , handler] = routes.find(([f]) => f.includes('timesheets'))!;
    signInAs('admin', { mfaMinutesAgo: 30 });
    const res = await handler(request('timesheets/x/export', 'GET'), context());
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('/reauth?next=');
    expect(state.calls).toEqual([]);
  });

  it('bulk ZIP download asks for the authenticator code again when it is stale', async () => {
    const [, , handler] = routes.find(([f]) => f.includes('zip'))!;
    signInAs('admin', { mfaMinutesAgo: 30 });
    const res = await handler(request('forms/submissions/zip', 'POST'), context());
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('/reauth?next=');
    expect(state.calls).toEqual([]);
  });

  it('the token endpoint refuses cross-site requests', async () => {
    const [, , handler] = routes.find(([f]) => f.includes('auth/token'))!;
    signInAs('admin');
    const req = new Request('http://localhost/auth/token', {
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    const res = await handler(req, context());
    expect(res.status).toBe(403);
    expect(res.headers.get('cache-control')).toContain('no-store');
  });
});
