import Link from 'next/link';
import { CardEditor } from '@/components/CardEditor';
import { PrimaryNameCard } from '@/components/PrimaryNameCard';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { ApiError, fetchConfig, fetchName, type NameData } from '@/lib/api';
import { buildProfileJsonLd, serializeJsonLd } from '@/lib/profileJsonLd';

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
  // Structured data for crawlers and other machines. It is built from the same
  // published card the page renders, so nothing private can leak into it.
  const jsonLd = serializeJsonLd(buildProfileJsonLd(data, config));

  return (
    <div className="page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {data.card.description ? (
                  <p className="body-2" style={{ fontSize: 16 }}>
                    {data.card.description}
                  </p>
                ) : null}

                <dl className="kv" style={{ gridTemplateColumns: '120px 1fr' }}>
                  {data.card.host ? (
                    <>
                      <dt>运行在</dt>
                      <dd>{data.card.host}</dd>
                    </>
                  ) : null}
                  {data.card.owner ? (
                    <>
                      <dt>主人</dt>
                      <dd>{data.card.owner}</dd>
                    </>
                  ) : null}
                  {data.card.contact ? (
                    <>
                      <dt>联系</dt>
                      <dd>{data.card.contact}</dd>
                    </>
                  ) : null}
                  {data.card.payoutAddress ? (
                    <>
                      <dt>收款</dt>
                      <dd className="mono-break">{data.card.payoutAddress}</dd>
                    </>
                  ) : null}
                </dl>

                {data.card.services?.length ? (
                  <div>
                    <div className="record-sample-label" style={{ color: 'var(--ink-3)' }}>
                      它能做什么 / 怎么找到它
                    </div>
                    <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {data.card.services.map((service) => (
                        <li key={`${service.name}-${service.endpoint}`} style={{ fontSize: 15 }}>
                          <span className="mono">{service.name}</span>
                          {' · '}
                          <a className="mono-break" href={service.endpoint} target="_blank" rel="noreferrer">
                            {service.endpoint}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {data.card.contentHash ? (
                  <p className="record-sample-label" style={{ margin: 0, color: 'var(--ink-3)' }}>
                    内容指纹 <span className="mono-break">{data.card.contentHash}</span>
                    <br />
                    这条记录存在链上的 ENS 文本记录里（键名 <span className="mono">musename.card</span>
                    ），任何人都能独立取回并重算这个指纹。
                  </p>
                ) : null}
              </div>
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

          <CardEditor
            config={config}
            label={decoded}
            fullName={data.fullName}
            ownerAddress={data.owner ?? ''}
            published={data.card}
          />

          <PrimaryNameCard fullName={data.fullName} ownerAddress={data.owner ?? ''} />

          <Link className="btn" href="/">
            回首页
          </Link>
        </main>
        <SiteFooter config={config} />
      </div>
    </div>
  );
}
