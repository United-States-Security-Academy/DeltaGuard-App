import { Directory, File, Paths } from 'expo-file-system';
import { readEncryptedText, writeEncryptedText } from './vault';

// Welfare check state kept on this phone, per signed-in user, so the prompt
// fires and answers are kept without signal:
//   welfare/<user id>/state.json

export type NextCheck = { id: string; scheduledAt: string; shiftId: string | null };

/** An answer given on this phone, waiting for a connection. */
export type QueuedAnswer = {
  checkId: string;
  /** When the officer confirmed (the phone's clock). */
  deviceTime: string;
  biometric: boolean;
  deviceId: string;
  tries: number;
};

export type WelfareLocal = {
  /** The next check as last fetched (prompts from it work offline). */
  next: NextCheck | null;
  /** `${id}@${scheduledAt}` of the check whose alerts are scheduled on the phone. */
  scheduledKey: string | null;
  /** Alarms scheduled through the Android module (to cancel them). */
  nativeIds: string[];
  /** check id -> when it was confirmed on this phone. */
  answered: Record<string, string>;
  queue: QueuedAnswer[];
  /** The policy's time to answer, from the latest check seen (default 60 s). */
  responseSeconds: number;
  /** The shift the duty screen was opened for automatically (once per shift). */
  dutyOpenedFor: string | null;
};

export const EMPTY_WELFARE: WelfareLocal = {
  next: null,
  scheduledKey: null,
  nativeIds: [],
  answered: {},
  queue: [],
  responseSeconds: 60,
  dutyOpenedFor: null,
};

function dir(userId: string): Directory {
  return new Directory(Paths.document, 'welfare', userId);
}

async function load(userId: string): Promise<WelfareLocal> {
  const file = new File(dir(userId), 'state.json');
  if (!file.exists) return EMPTY_WELFARE;
  try {
    return {
      ...EMPTY_WELFARE,
      ...(JSON.parse(await readEncryptedText(file, userId)) as Partial<WelfareLocal>),
    };
  } catch {
    return EMPTY_WELFARE;
  }
}

async function save(userId: string, value: WelfareLocal): Promise<void> {
  const d = dir(userId);
  d.create({ intermediates: true, idempotent: true });
  // Encrypted at rest (lib/vault.ts).
  await writeEncryptedText(new File(d, 'state.json'), userId, JSON.stringify(value));
}

// One read-modify-write at a time (the prompt, the queue and the scheduler all write).
let chain: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

export function readWelfare(userId: string): Promise<WelfareLocal> {
  return exclusive(() => load(userId));
}

export function updateWelfare(
  userId: string,
  fn: (state: WelfareLocal) => WelfareLocal,
): Promise<WelfareLocal> {
  return exclusive(async () => {
    const next = fn(await load(userId));
    await save(userId, next);
    return next;
  });
}

/** Keeps the answered list short (the latest 50). */
export function trimAnswered(answered: Record<string, string>): Record<string, string> {
  const entries = Object.entries(answered).sort((a, b) => b[1].localeCompare(a[1]));
  return Object.fromEntries(entries.slice(0, 50));
}
