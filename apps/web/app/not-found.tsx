import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="page">
      <div className="container">
        <main className="narrow">
          <h1 className="h2">No such page.</h1>
          <p className="body-2">The address may be wrong, or that name has not been registered.</p>
          <Link className="btn btn-primary" href="/">
            Back to the home page
          </Link>
        </main>
      </div>
    </div>
  );
}
