import type { z } from 'zod';

/** What every form server action returns to useActionState. */
export type ActionState = {
  ok: boolean;
  message: string;
  fieldErrors?: Record<string, string>;
  /** Set when a sensitive action needs the authenticator code first (see lib/auth.ts). */
  reauthUrl?: string;
} | null;

/** First error message per field, for showing under inputs. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    out[key] ??= issue.message;
  }
  return out;
}

export function invalid(error: z.ZodError): ActionState {
  return {
    ok: false,
    message: 'Please fix the highlighted fields.',
    fieldErrors: fieldErrors(error),
  };
}
