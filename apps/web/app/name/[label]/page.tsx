import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { ApiError, fetchConfig, fetchName, type NameData } from '@/lib/api';

export async function generateMetadata({ params }: { params: Promise<{ label: string }> }) {
  const { label } = await params;
  const config = await fetchConfig();
  return { title: `${decodeURIComponent(label)}.${config.rootName}` };
}

export default async function NamePage({ params }: { params: Promise<{ label: string }> }) {
  const [{ label }, config] = await Promise.all([params, fetchConfig()]);
  const decoded = decodeURIComponent(label);

  let data: NameData | null = null;
  let unavailable = false;
  try {
    const payload = await fetchName(decoded);
    data = payload.data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      data = null;
    } else {
      unavailable = true;
    }
  }

  if (unavailable) {
    return (
      <div className="page">
        <div className="container">
          <SiteHeader config={config} />
          <main className="narrow">
            <h1 className="h2">{decoded}</h1>
            <div className="notice notice-warn">
              链上暂时查不到这个名字，请稍后再刷新。我们没有猜测结果。
            </div>
          </main>
          <SiteFooter config={config} />
        </div>
      </div>
    );
  }

  if (data === null) {
    // A 404 is a real answer: nobody owns this name.
    return (
      <div className="page">
        <div className="container">
          <SiteHeader config={config} />
          <main className="narrow">
            <h1 className="h2">
              <span className="mono">{decoded}</span>.{config.rootName}
            </h1>
            <div className="notice notice-info">这个名字还没有被注册。</div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <Link className="btn btn-primary" href={`/claim?label=${encodeURIComponent(decoded)}`}>
                连接钱包领取
              </Link>
              <Link className="btn" href="/">
                回首页
              </Link>
            </div>
          </main>
          <SiteFooter config={config} />
        </div>
      </div>
    );
  }

  const explorer = config.chain.explorer;

  return (
    <div className="page">
      <div className="container">
        <SiteHeader config={config} />
        <main className="narrow">
          <h1 className="h2">
            <span className="mono">{decoded}</span>.{config.rootName}
          </h1>

          <div className="panel">
            <dl className="kv">
              <dt>所有者</dt>
              <dd className="mono-break">
                {data.owner && explorer ? (
                  <a href={`${explorer}/address/${data.owner}`} target="_blank" rel="noreferrer">
                    {data.owner}
                  </a>
                ) : (
                  (data.owner ?? '—')
                )}
              </dd>
              {data.index ? (
                <>
                  <dt>注册时间</dt>
                  <dd>{new Date(data.index.registeredAt).toISOString().slice(0, 10)}</dd>
                  <dt>注册渠道</dt>
                  <dd>{data.index.registeredVia === 'mcp' ? 'AI 一句话注册' : '网页注册'}</dd>
                </>
              ) : null}
            </dl>
          </div>

          <div className="panel">
            <h2 className="faq-q" style={{ fontSize: 18 }}>
              名片
            </h2>
            {data.card ? (
              <pre className="mono-break">{JSON.stringify(data.card, null, 2)}</pre>
            ) : (
              <div className="notice notice-info">
                还没有公开名片。名片按 ERC-8004 标准生成，公开哪些字段由主人逐项决定，默认只公开名字和地址。
              </div>
            )}
          </div>

          <div className="panel">
            <h2 className="faq-q" style={{ fontSize: 18 }}>
              履历
            </h2>
            {data.trackRecord ? (
              <pre className="mono-break">{JSON.stringify(data.trackRecord, null, 2)}</pre>
            ) : (
              <div className="notice notice-info">
                还没有履历。履历只记录能被证据证明的事，判定标准在开工前登记、事后不能改。
                {config.features.trackRecord ? '' : '（认证履历尚未开放）'}
              </div>
            )}
          </div>

          <Link className="btn" href="/">
            回首页
          </Link>
        </main>
        <SiteFooter config={config} />
      </div>
    </div>
  );
}
