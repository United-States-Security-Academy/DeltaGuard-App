import {
  type AttemptResult,
  attemptResultSchema,
  isOfflineError,
  TRAINING_ERROR_CODES,
} from '@deltaguard/shared';
import { useQueryClient } from '@tanstack/react-query';
import * as Network from 'expo-network';
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

import { isOfflineState, looksOffline } from './network';
import { supabase } from './supabase';
import { trainingKeys } from './training';
import {
  EMPTY_STATE,
  emptyLesson,
  type LessonLocal,
  type PendingSubmission,
  type QuizDraft,
  readTraining,
  type TrainingState,
  updateTraining,
} from './training-store';

// Training sync: reading progress and quiz answers made on this phone reach
// the server here, whenever there is a connection.
//
// Progress: pages viewed and seconds spent (counted only while the reader is
// open and the app is in the foreground) are added to `pendingPages` /
// `pendingSeconds` and sent with record_lesson_progress(); what was sent is
// subtracted only after the server confirms, so nothing is lost or counted
// twice. The server decides when reading is complete (every page viewed).
//
// Quiz answers: submit_attempt() needs a connection. Answers submitted
// offline are queued and sent when the phone is back online. The time limit
// is measured on the server from when the quiz was opened, so a late arrival
// can be scored as over time. Progress is always sent before answers, so the
// server knows the reading is complete.

type Value = {
  state: TrainingState;
  loaded: boolean;
  markViewed: (lessonId: string, page: number) => void;
  addSeconds: (lessonId: string, seconds: number) => void;
  setLastPage: (lessonId: string, page: number) => void;
  saveDraft: (assessmentId: string, draft: QuizDraft | null) => Promise<void>;
  /** Queues the answers and tries to send them now. Returns the result when it got through. */
  submitAnswers: (
    s: Omit<PendingSubmission, 'queuedAt' | 'state' | 'tries' | 'nextTryAt' | 'lastError'>,
  ) => Promise<
    | { kind: 'graded'; result: AttemptResult }
    | { kind: 'queued' }
    | { kind: 'refused'; message: string }
  >;
  syncNow: () => Promise<void>;
};

const Ctx = createContext<Value | null>(null);

export function useTrainingSync(): Value {
  const value = use(Ctx);
  if (!value) throw new Error('useTrainingSync must be used inside <TrainingSyncProvider>');
  return value;
}

const CHECK_EVERY_MS = 30_000;
const backoff = (tries: number) => Math.min(30_000 * 2 ** Math.max(0, tries - 1), 15 * 60_000);

function lessonOf(state: TrainingState, id: string): LessonLocal {
  return state.lessons[id] ?? emptyLesson();
}

/** Errors that mean "try again later" (no signal, timeouts, server trouble). */
function transient(error: { code?: string; message?: string } | null, status?: number): boolean {
  if (!error) return false;
  if (isOfflineError(error)) return true;
  return !status || status >= 500 || [401, 408, 429].includes(status);
}

export function TrainingSyncProvider({
  userId,
  children,
}: {
  userId: string;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<TrainingState>(EMPTY_STATE);
  const [loaded, setLoaded] = useState(false);
  const running = useRef(false);
  const again = useRef(false);

  const update = useCallback(
    async (fn: (s: TrainingState) => TrainingState) => {
      const next = await updateTraining(userId, fn);
      setState(next);
      return next;
    },
    [userId],
  );

  const send = useCallback(
    async (sub: PendingSubmission): Promise<'graded' | 'refused' | 'transient'> => {
      const { data, error, status } = await supabase.rpc('submit_attempt', {
        p_assessment_id: sub.assessmentId,
        p_answers: sub.answers,
      });
      if (!error) {
        const parsed = attemptResultSchema.safeParse(data);
        await update((s) => ({
          ...s,
          submissions: s.submissions.filter((x) => x.attemptId !== sub.attemptId),
          drafts: Object.fromEntries(
            Object.entries(s.drafts).filter(([k]) => k !== sub.assessmentId),
          ),
          results: parsed.success
            ? { ...s.results, [sub.assessmentId]: { ...parsed.data, at: Date.now() } }
            : s.results,
        }));
        return 'graded';
      }
      // The server hasn't recorded the reading yet: try again after progress syncs.
      const retry =
        transient(error, status) || error.code === TRAINING_ERROR_CODES.readingNotComplete;
      await update((s) => ({
        ...s,
        submissions: s.submissions.map((x) =>
          x.attemptId !== sub.attemptId
            ? x
            : retry
              ? {
                  ...x,
                  tries: x.tries + 1,
                  nextTryAt: Date.now() + backoff(x.tries + 1),
                  lastError: error.message,
                }
              : { ...x, state: 'failed', lastError: error.message, nextTryAt: null },
        ),
      }));
      return retry ? 'transient' : 'refused';
    },
    [update],
  );

  /** One pass: progress first, then queued answers. */
  const run = useCallback(
    async function run(force: boolean): Promise<void> {
      if (running.current) {
        again.current = true;
        return;
      }
      running.current = true;
      let changed = false;
      try {
        if (await looksOffline()) return;
        const current = await readTraining(userId);

        for (const [lessonId, l] of Object.entries(current.lessons)) {
          if (l.pendingPages.length === 0 && l.pendingSeconds < 1) continue;
          const pages = [...l.pendingPages];
          const seconds = Math.min(Math.floor(l.pendingSeconds), 3600);
          const { error, status } = await supabase.rpc('record_lesson_progress', {
            p_lesson_id: lessonId,
            p_pages: pages,
            p_seconds: seconds,
          });
          if (error && transient(error, status)) break;
          // Sent, or refused for good (e.g. no longer assigned): either way, clear it.
          await update((s) => {
            const x = lessonOf(s, lessonId);
            return {
              ...s,
              lessons: {
                ...s.lessons,
                [lessonId]: {
                  ...x,
                  pendingPages: x.pendingPages.filter((p) => !pages.includes(p)),
                  pendingSeconds: Math.max(0, x.pendingSeconds - seconds),
                },
              },
            };
          });
          changed = true;
        }

        const due = (await readTraining(userId)).submissions.filter(
          (s) => s.state === 'queued' && (force || (s.nextTryAt ?? 0) <= Date.now()),
        );
        for (const sub of due) {
          const outcome = await send(sub);
          if (outcome === 'transient') break;
          changed = true;
        }
      } finally {
        running.current = false;
        if (changed) void queryClient.invalidateQueries({ queryKey: trainingKeys.all });
      }
      if (again.current) {
        again.current = false;
        await run(true);
      }
    },
    [userId, update, queryClient, send],
  );

  useEffect(() => {
    let cancelled = false;
    void readTraining(userId).then((s) => {
      if (cancelled) return;
      setState(s);
      setLoaded(true);
      void run(true);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, run]);

  const pending =
    state.submissions.some((s) => s.state === 'queued') ||
    Object.values(state.lessons).some((l) => l.pendingPages.length > 0 || l.pendingSeconds >= 1);

  useEffect(() => {
    if (!pending) return;
    const network = Network.addNetworkStateListener((s) => {
      if (!isOfflineState(s)) void run(true);
    });
    const app = AppState.addEventListener('change', (s) => {
      if (s === 'active') void run(true);
    });
    const timer = setInterval(() => void run(false), CHECK_EVERY_MS);
    return () => {
      network.remove();
      app.remove();
      clearInterval(timer);
    };
  }, [pending, run]);

  const markViewed = useCallback(
    (lessonId: string, page: number) =>
      void update((s) => {
        const x = lessonOf(s, lessonId);
        if (x.viewed.includes(page)) return s;
        return {
          ...s,
          lessons: {
            ...s.lessons,
            [lessonId]: {
              ...x,
              viewed: [...x.viewed, page],
              pendingPages: [...x.pendingPages, page],
            },
          },
        };
      }).then(() => run(false)),
    [update, run],
  );

  const addSeconds = useCallback(
    (lessonId: string, seconds: number) =>
      void update((s) => {
        const x = lessonOf(s, lessonId);
        return {
          ...s,
          lessons: {
            ...s.lessons,
            [lessonId]: { ...x, pendingSeconds: x.pendingSeconds + seconds },
          },
        };
      }).then(() => run(false)),
    [update, run],
  );

  const setLastPage = useCallback(
    (lessonId: string, page: number) =>
      void update((s) => ({
        ...s,
        lessons: { ...s.lessons, [lessonId]: { ...lessonOf(s, lessonId), lastPage: page } },
      })),
    [update],
  );

  const saveDraft = useCallback(
    async (assessmentId: string, draft: QuizDraft | null) => {
      await update((s) => ({
        ...s,
        drafts: draft
          ? { ...s.drafts, [assessmentId]: draft }
          : Object.fromEntries(Object.entries(s.drafts).filter(([k]) => k !== assessmentId)),
      }));
    },
    [update],
  );

  const submitAnswers = useCallback<Value['submitAnswers']>(
    async (s) => {
      const sub: PendingSubmission = {
        ...s,
        queuedAt: Date.now(),
        state: 'queued',
        tries: 0,
        nextTryAt: null,
        lastError: null,
      };
      await update((st) => ({
        ...st,
        submissions: [...st.submissions.filter((x) => x.attemptId !== sub.attemptId), sub],
      }));
      await run(true);
      const after = await readTraining(userId);
      const result = after.results[s.assessmentId];
      const still = after.submissions.find((x) => x.attemptId === sub.attemptId);
      if (!still && result && result.attempt_id === sub.attemptId)
        return { kind: 'graded', result };
      if (still?.state === 'failed')
        return { kind: 'refused', message: still.lastError ?? 'Not accepted.' };
      return { kind: 'queued' };
    },
    [update, run, userId],
  );

  const syncNow = useCallback(() => run(true), [run]);

  const value = useMemo(
    () => ({
      state,
      loaded,
      markViewed,
      addSeconds,
      setLastPage,
      saveDraft,
      submitAnswers,
      syncNow,
    }),
    [state, loaded, markViewed, addSeconds, setLastPage, saveDraft, submitAnswers, syncNow],
  );
  return <Ctx value={value}>{children}</Ctx>;
}
