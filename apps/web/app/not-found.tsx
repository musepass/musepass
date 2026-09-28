import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="page">
      <div className="container">
        <main className="narrow">
          <h1 className="h2">没有这个页面。</h1>
          <p className="body-2">地址可能打错了，或者这个名字还没有被注册。</p>
          <Link className="btn btn-primary" href="/">
            回首页
          </Link>
        </main>
      </div>
    </div>
  );
}
