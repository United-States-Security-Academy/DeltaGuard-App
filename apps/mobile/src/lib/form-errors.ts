/** The part of a ZodError we need (avoids a direct zod dependency here). */
type IssueList = { issues: readonly { path: readonly PropertyKey[]; message: string }[] };

/** First validation message per field, for showing under inputs. */
export function fieldErrors<T extends string>(error: IssueList): Partial<Record<T, string>> {
  const out: Partial<Record<T, string>> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0]) as T;
    out[key] ??= issue.message;
  }
  return out;
}
