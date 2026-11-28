import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-md panel p-7 text-center">
        <h1 className="text-xl font-semibold">Not found</h1>
        <p className="mt-2 text-sm text-muted">
          This page doesn’t exist, or you don’t have access to it.
        </p>
        <Link href="/" className="mt-5 inline-block text-sm font-medium text-accent-ink underline">
          Back to the dashboard
        </Link>
      </div>
    </main>
  );
}
