'use client';

// Errors in the root layout itself. Plain HTML: the layout (and its styles)
// failed. Never shows the error's message or stack.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: '3rem', textAlign: 'center' }}>
        <h1>Something went wrong</h1>
        <p>
          Reload the page. If it keeps happening, tell an administrator
          {error.digest ? ` and quote reference ${error.digest}` : ''}.
        </p>
      </body>
    </html>
  );
}
