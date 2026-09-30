'use client';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="page">
      <div className="container">
        <main className="narrow">
          <h1 className="h2">Something went wrong.</h1>
          <div className="notice notice-error">
            We could not render this page. Nothing happened on chain, and nothing was charged.
          </div>
          {error.digest ? <p className="mono-break">Error id: {error.digest}</p> : null}
          <button type="button" className="btn btn-primary" onClick={reset}>
            Try again
          </button>
        </main>
      </div>
    </div>
  );
}
