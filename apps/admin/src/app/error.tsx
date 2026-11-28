'use client';

// Any unexpected error on a page. Shows nothing about the error itself (no
// message, stack, SQL or data): only the digest, which matches the server log
// entry so staff can quote it.
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-md panel p-7 text-center">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted">
          The page couldn’t be loaded. Try again; if it keeps happening, tell an administrator
          {error.digest ? (
            <>
              {' '}
              and quote reference <code className="font-mono">{error.digest}</code>
            </>
          ) : null}
          .
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-5 rounded-full bg-ink px-4 py-2 text-sm font-medium text-white dark:bg-gold dark:text-ink"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
