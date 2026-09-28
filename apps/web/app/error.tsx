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
          <h1 className="h2">页面出错了。</h1>
          <div className="notice notice-error">
            我们没能渲染这一页。没有发生任何链上操作，也不会产生任何费用。
          </div>
          {error.digest ? <p className="mono-break">错误编号：{error.digest}</p> : null}
          <button type="button" className="btn btn-primary" onClick={reset}>
            重试
          </button>
        </main>
      </div>
    </div>
  );
}
