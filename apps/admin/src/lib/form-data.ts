// Read FormData into the shapes the shared Zod schemas expect. Zod does the
// real validation; these only convert HTML's "everything is a string" into
// null / numbers / booleans.

/** Trimmed text, or null when the field is missing or blank. */
export function text(fd: FormData, key: string): string | null {
  const value = fd.get(key);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** A number, or null when blank. NaN is passed through so Zod rejects it. */
export function num(fd: FormData, key: string): number | null {
  const value = text(fd, key);
  return value === null ? null : Number(value);
}

/** Checkbox: "on" when ticked, absent when not. */
export function checked(fd: FormData, key: string): boolean {
  return fd.get(key) === 'on';
}

/** A JSON-encoded field (e.g. a list edited client-side). Invalid JSON → undefined. */
export function json(fd: FormData, key: string): unknown {
  const value = text(fd, key);
  if (value === null) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/** Postgres unique-violation code, for friendlier messages. */
export const UNIQUE_VIOLATION = '23505';
/** Postgres foreign-key violation (e.g. deleting a client that still has sites). */
export const FOREIGN_KEY_VIOLATION = '23503';
