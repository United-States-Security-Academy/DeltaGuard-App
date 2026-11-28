import type { AttemptResult, OfficerAssessment } from '@deltaguard/shared';
import { Directory, File, Paths } from 'expo-file-system';
import { readEncryptedText, writeEncryptedText } from './vault';

// Training state kept on this phone, per signed-in user, so lessons can be
// studied and quizzes answered without signal:
//   training/<user id>/state.json
//   training/<user id>/lessons/<lesson id>-v<version>/meta.json + page-<n>.png
// Reading progress and quiz submissions wait here until training-sync.tsx
// gets them to the server.

export type LessonLocal = {
  /** 1-based page to reopen the lesson at. */
  lastPage: number;
  /** Every page seen on this phone (synced or not). */
  viewed: number[];
  /** Pages and seconds not yet recorded on the server. */
  pendingPages: number[];
  pendingSeconds: number;
};

/** A quiz in progress (resumed if the app closes). */
export type QuizDraft = {
  quiz: OfficerAssessment;
  /** question id -> option ids */
  answers: Record<string, string[]>;
  index: number;
};

/** Answers waiting for a connection; graded by submit_attempt() when sent. */
export type PendingSubmission = {
  assessmentId: string;
  lessonId: string;
  attemptId: string;
  answers: Record<string, string[]>;
  queuedAt: number;
  state: 'queued' | 'failed';
  tries: number;
  nextTryAt: number | null;
  lastError: string | null;
};

export type TrainingState = {
  lessons: Record<string, LessonLocal>;
  drafts: Record<string, QuizDraft>;
  submissions: PendingSubmission[];
  /** The latest graded result per assessment (shown after an offline submit lands). */
  results: Record<string, AttemptResult & { at: number }>;
};

export const EMPTY_STATE: TrainingState = { lessons: {}, drafts: {}, submissions: [], results: {} };

export function emptyLesson(): LessonLocal {
  return { lastPage: 1, viewed: [], pendingPages: [], pendingSeconds: 0 };
}

function root(userId: string): Directory {
  return new Directory(Paths.document, 'training', userId);
}

async function writeJson(dir: Directory, name: string, value: unknown): Promise<void> {
  dir.create({ intermediates: true, idempotent: true });
  const tmp = new File(dir, `${name}.tmp`);
  if (tmp.exists) tmp.delete();
  tmp.create();
  await tmp.write(JSON.stringify(value));
  await tmp.move(new File(dir, name), { overwrite: true });
}

async function load(userId: string): Promise<TrainingState> {
  const file = new File(root(userId), 'state.json');
  if (!file.exists) return EMPTY_STATE;
  try {
    const parsed = JSON.parse(await readEncryptedText(file, userId)) as Partial<TrainingState>;
    return {
      lessons: parsed.lessons ?? {},
      drafts: parsed.drafts ?? {},
      submissions: Array.isArray(parsed.submissions) ? parsed.submissions : [],
      results: parsed.results ?? {},
    };
  } catch {
    return EMPTY_STATE;
  }
}

// One read-modify-write at a time (the reader, the quiz and the sync loop all write).
let chain: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

export function readTraining(userId: string): Promise<TrainingState> {
  return exclusive(() => load(userId));
}

export function updateTraining(
  userId: string,
  fn: (state: TrainingState) => TrainingState,
): Promise<TrainingState> {
  return exclusive(async () => {
    const next = fn(await load(userId));
    root(userId).create({ intermediates: true, idempotent: true });
    // Quiz answers and queued submissions: encrypted at rest (lib/vault.ts).
    await writeEncryptedText(new File(root(userId), 'state.json'), userId, JSON.stringify(next));
    return next;
  });
}

// ---------------------------------------------------------------------------
// Lesson pages, cached for offline reading
// ---------------------------------------------------------------------------

export type CachedLesson = { pages: string[]; aspects: number[] };

function lessonDir(userId: string, lessonId: string, version: number): Directory {
  return new Directory(root(userId), 'lessons', `${lessonId}-v${version}`);
}

export async function readCachedLesson(
  userId: string,
  lessonId: string,
  version: number,
): Promise<CachedLesson | null> {
  const meta = new File(lessonDir(userId, lessonId, version), 'meta.json');
  if (!meta.exists) return null;
  try {
    const cached = JSON.parse(await meta.text()) as CachedLesson;
    return cached.pages.every((uri) => new File(uri).exists) ? cached : null;
  } catch {
    return null;
  }
}

/** The newest cached version of a lesson (offline, when the version can't be checked). */
export async function latestCachedLesson(
  userId: string,
  lessonId: string,
): Promise<CachedLesson | null> {
  const dir = new Directory(root(userId), 'lessons');
  if (!dir.exists) return null;
  const versions = dir
    .list()
    .map((e) => e.name)
    .filter((n) => n.startsWith(`${lessonId}-v`))
    .map((n) => Number(n.slice(lessonId.length + 2)))
    .filter(Number.isInteger)
    .sort((a, b) => b - a);
  for (const v of versions) {
    const cached = await readCachedLesson(userId, lessonId, v);
    if (cached) return cached;
  }
  return null;
}

export async function cacheLesson(
  userId: string,
  lessonId: string,
  version: number,
  urls: string[],
  measure: (uri: string) => Promise<number>,
  onProgress?: (done: number, total: number) => void,
): Promise<CachedLesson> {
  const dir = lessonDir(userId, lessonId, version);
  dir.create({ intermediates: true, idempotent: true });
  const pages: string[] = [];
  for (const [i, url] of urls.entries()) {
    const target = new File(dir, `page-${i + 1}.png`);
    if (!target.exists) await File.downloadFileAsync(url, target, { idempotent: true });
    pages.push(target.uri);
    onProgress?.(i + 1, urls.length);
  }
  const cached = { pages, aspects: await Promise.all(pages.map(measure)) };
  await writeJson(dir, 'meta.json', cached);
  return cached;
}
