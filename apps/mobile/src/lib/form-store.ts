import type { FormFieldType } from '@deltaguard/shared';
import { Directory, File, Paths } from 'expo-file-system';
import { fromBase64, readEncryptedText, writeEncryptedBytes, writeEncryptedText } from './vault';

// Forms that live on this phone: drafts being filled in, submitted forms
// waiting to be sent (the offline queue, see form-sync.tsx), and a copy of
// each published form version used, so a form can be filled with no signal.
//
// Storage: the app's private document directory (sandboxed by the OS,
// encrypted at rest with the phone's lock), one folder per signed-in user:
//   forms/<user id>/forms.json                  every local form (this file)
//   forms/<user id>/<submission id>/signature-<time>.png
//   forms/<user id>/templates/<template id>-v<version>/version.json + page-<n>.png
// A form's folder is deleted once the server has it.

/** One field of a published version (form_template_versions.fields). */
export type VersionField = {
  key: string;
  label: string;
  type: FormFieldType;
  options: string[] | null;
  required: boolean;
  /** 1-based page number. */
  page: number;
  /**
   * Position and size as FRACTIONS (0..1) of the page as displayed, measured
   * from its top-left corner. See components/form-page.tsx for how they map
   * to the screen and the Edge Function for how they map to the PDF.
   */
  x: number;
  y: number;
  width: number;
  height: number;
  font_size: number;
  sort_order: number;
};

/** A published form version, cached for offline use. */
export type CachedVersion = {
  templateId: string;
  version: number;
  title: string;
  description: string | null;
  fields: VersionField[];
  /** file:// URIs of the page images on this phone, in page order. */
  pages: string[];
  /** Width / height of each page image (for laying out boxes before it loads). */
  aspects: number[];
};

export type LocalSignature = {
  /** file:// URI of the transparent PNG on this phone. */
  localUri: string;
  /** Path in the form-submissions bucket (fixed when drawn, so retries reuse it). */
  path: string;
  uploaded: boolean;
  /** Saved as signature_path on the server row. */
  attached: boolean;
};

export type LocalForm = {
  /** Also the server id: chosen here so a retried send can't create a duplicate. */
  id: string;
  templateId: string;
  /** The published version these answers were filled on. */
  templateVersion: number;
  assignmentId: string | null;
  title: string;
  values: Record<string, unknown>;
  signature: LocalSignature | null;
  /** A returned form already has a signature on the server (kept unless re-signed). */
  serverSignaturePath: string | null;
  /** The server row exists (inserted by an earlier send, or a returned form). */
  serverRow: boolean;
  /** What the reviewer asked for (returned forms). */
  reviewNotes: string | null;
  /**
   * draft: being filled, editable.
   * queued: confirmed (with biometrics) and waiting to be sent.
   * failed: the server refused it (e.g. a required answer missing on a newer
   *         version); the officer edits and submits again.
   */
  state: 'draft' | 'queued' | 'failed';
  /** Per-field problems from the server (key -> message). */
  problems: Record<string, string>;
  attempts: number;
  nextAttemptAt: number | null;
  lastError: string | null;
  updatedAt: number;
  queuedAt: number | null;
  /** When the officer confirmed with biometrics (phone time). */
  confirmedAt: number | null;
};

/** A fresh draft (nothing on the server yet). */
export function newLocalForm(
  id: string,
  templateId: string,
  templateVersion: number,
  assignmentId: string | null,
  title: string,
): LocalForm {
  return {
    id,
    templateId,
    templateVersion,
    assignmentId,
    title,
    values: {},
    signature: null,
    serverSignaturePath: null,
    serverRow: false,
    reviewNotes: null,
    state: 'draft',
    problems: {},
    attempts: 0,
    nextAttemptAt: null,
    lastError: null,
    updatedAt: Date.now(),
    queuedAt: null,
    confirmedAt: null,
  };
}

function root(userId: string): Directory {
  return new Directory(Paths.document, 'forms', userId);
}

export function formDir(userId: string, id: string): Directory {
  return new Directory(root(userId), id);
}

function indexFile(userId: string): File {
  return new File(root(userId), 'forms.json');
}

function isLocalForm(value: unknown): value is LocalForm {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.templateId === 'string' &&
    (v.state === 'draft' || v.state === 'queued' || v.state === 'failed') &&
    typeof v.values === 'object' &&
    v.values !== null
  );
}

async function load(userId: string): Promise<LocalForm[]> {
  const file = indexFile(userId);
  if (!file.exists) return [];
  try {
    const parsed: unknown = JSON.parse(await readEncryptedText(file, userId));
    return Array.isArray(parsed) ? parsed.filter(isLocalForm) : [];
  } catch {
    return [];
  }
}

async function writeJson(dir: Directory, name: string, value: unknown): Promise<void> {
  dir.create({ intermediates: true, idempotent: true });
  // Write a new file, then swap it in: a crash mid-write can't corrupt it.
  const tmp = new File(dir, `${name}.tmp`);
  if (tmp.exists) tmp.delete();
  tmp.create();
  await tmp.write(JSON.stringify(value));
  await tmp.move(new File(dir, name), { overwrite: true });
}

// Every read-modify-write runs one at a time, so autosave and the send loop
// can't overwrite each other's changes.
let chain: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

export function readAllForms(userId: string): Promise<LocalForm[]> {
  return exclusive(() => load(userId));
}

/** Changes one form (or creates it when `fn` gets null). Returning null removes it. */
export function updateForm(
  userId: string,
  id: string,
  fn: (current: LocalForm | null) => LocalForm | null,
): Promise<LocalForm[]> {
  return exclusive(async () => {
    const items = await load(userId);
    const index = items.findIndex((i) => i.id === id);
    const next = fn(index >= 0 ? items[index]! : null);
    if (next === null) {
      if (index >= 0) items.splice(index, 1);
    } else if (index >= 0) {
      items[index] = next;
    } else {
      items.push(next);
    }
    root(userId).create({ intermediates: true, idempotent: true });
    // Drafts (values, signature path) are encrypted at rest (lib/vault.ts).
    await writeEncryptedText(indexFile(userId), userId, JSON.stringify(items));
    return items;
  });
}

export function deleteFormFiles(userId: string, id: string): void {
  try {
    const dir = formDir(userId, id);
    if (dir.exists) dir.delete();
  } catch {
    // Retried on the next delete.
  }
}

/**
 * Saves a signature PNG (base64) into the form's folder, encrypted
 * (lib/vault.ts), and returns it. `fileName` is the name it is uploaded as.
 */
export async function saveSignaturePng(
  userId: string,
  formId: string,
  base64: string,
): Promise<{ localUri: string; fileName: string }> {
  const dir = formDir(userId, formId);
  dir.create({ intermediates: true, idempotent: true });
  const fileName = `signature-${Date.now()}.png`;
  const file = new File(dir, `${fileName}.enc`);
  await writeEncryptedBytes(file, userId, fromBase64(base64));
  return { localUri: file.uri, fileName };
}

// ---------------------------------------------------------------------------
// Cached published versions
// ---------------------------------------------------------------------------

function versionDir(userId: string, templateId: string, version: number): Directory {
  return new Directory(root(userId), 'templates', `${templateId}-v${version}`);
}

export async function readCachedVersion(
  userId: string,
  templateId: string,
  version: number,
): Promise<CachedVersion | null> {
  const file = new File(versionDir(userId, templateId, version), 'version.json');
  if (!file.exists) return null;
  try {
    const cached = JSON.parse(await file.text()) as CachedVersion;
    // Every page image must still be on the phone.
    return cached.pages.every((uri) => new File(uri).exists) ? cached : null;
  } catch {
    return null;
  }
}

/** Downloads the page images (signed URLs) and stores the version for offline use. */
export async function cacheVersion(
  userId: string,
  meta: Omit<CachedVersion, 'pages' | 'aspects'>,
  pageUrls: string[],
  measure: (uri: string) => Promise<number>,
): Promise<CachedVersion> {
  const dir = versionDir(userId, meta.templateId, meta.version);
  dir.create({ intermediates: true, idempotent: true });
  const pages: string[] = [];
  for (const [i, url] of pageUrls.entries()) {
    const target = new File(dir, `page-${i + 1}.png`);
    if (!target.exists) await File.downloadFileAsync(url, target, { idempotent: true });
    pages.push(target.uri);
  }
  const aspects = await Promise.all(pages.map(measure));
  const cached: CachedVersion = { ...meta, pages, aspects };
  await writeJson(dir, 'version.json', cached);
  return cached;
}

/** The most recent cached version of a template, if any (offline fallback). */
export async function latestCachedVersion(
  userId: string,
  templateId: string,
): Promise<CachedVersion | null> {
  const dir = new Directory(root(userId), 'templates');
  if (!dir.exists) return null;
  const versions = dir
    .list()
    .map((entry) => entry.name)
    .filter((name) => name.startsWith(`${templateId}-v`))
    .map((name) => Number(name.slice(templateId.length + 2)))
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => b - a);
  for (const v of versions) {
    const cached = await readCachedVersion(userId, templateId, v);
    if (cached) return cached;
  }
  return null;
}
