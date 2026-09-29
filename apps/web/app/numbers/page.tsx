import Link from 'next/link';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { ApiError, fetchConfig, fetchMetrics, type MetricsData } from '@/lib/api';

export const metadata = { title: '数字' };
/**
 * Rendered per request, not prerendered.
 *
 * `revalidate` would bake whatever the build machine could reach into the first
 * HTML — and the build machine is the developer laptop, where the API is not
 * running. The first deploy of this page served "cannot reach the name service"
 * as a static page, which is exactly the kind of failure that looks like a
 * product problem instead of a deployment one. The API already caches the chain
 * read for five minutes, so a live render costs nothing extra.
 */
export const dynamic = 'force-dynamic';

/**
 * The API answers in English because its consumers are machines. This page is
 * for people, so the known gaps get a Chinese name and a Chinese reason, keyed
 * by the stable id the API sends — an unknown id still renders, in English,
 * rather than disappearing.
 */
const GAP_ZH: Record<string, { title: string; why: string }> = {
  queries_by_others: {
    title: '除了我们自己，还有谁查询过',
    why: '还没有按调用方统计 API/MCP 请求；我们自己跑测试会把数字刷高，所以现在报不出来。',
  },
  records: {
    title: '记录条数与判定结果',
    why: '记录注册表已写完并通过测试，但还没有部署，链上没有可读的记录。',
  },
  external_verifier_records: {
    title: '由我们团队之外的验证方出具的记录',
    why: '目前唯一的验证方是我们自己的引擎（the project's own engine），把它说成"独立验证"是不成立的。',
  },
  unique_users: {
    title: '独立用户数',
    why: '一个名字对应一个钱包地址，一个人可以持有多个；按地址数当人数就是在猜。',
  },
};

/**
 * The public numbers.
 *
 * Two rules this page follows, both borrowed from the API it renders:
 *
 *   1. The count of names comes from the chain and says so; the index numbers are
 *      labelled as index numbers, because a memory index is emptied by a restart
 *      and would otherwise look like a fact about the world.
 *   2. What cannot be measured yet is printed too, with the reason. A dashboard
 *      that only shows what flatters it is a brochure.
 *
 * An empty page would be a poor look and a good signal: if the numbers are not
 * worth showing, the honest response is to build something people use, not to
 * hide the page.
 */
export default async function NumbersPage() {
  const config = await fetchConfig();
  let metrics: MetricsData | null = null;
  let error: string | null = null;
  try {
    metrics = (await fetchMetrics()).data;
  } catch (caught) {
    error = caught instanceof ApiError ? caught.message : '读不到数字，稍后再试。';
  }

  const row = (label: string, value: React.ReactNode) => (
    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
      <span className="body-2" style={{ margin: 0 }}>
        {label}
      </span>
      <span className="mono" style={{ fontWeight: 600 }}>
        {value}
      </span>
    </div>
  );

  return (
    <div className="page">
      <div className="container">
        <SiteHeader config={config} />
        <main className="narrow">
          <h1 className="h2">数字</h1>
          <p className="body-2">
            这一页只放能被核对的东西。名字数量从链上事件读（任何人可以自己数），
            索引里的数字标明来源；暂时量不出来的，也一并写在下面，并说明为什么。
          </p>

          {error || !metrics ? (
            <div className="notice notice-warn">{error ?? '读不到数字，稍后再试。'}</div>
          ) : (
            <>
              <h2 className="faq-q" style={{ fontSize: 18 }}>
                名字
              </h2>
              {row(
                '链上已注册（来自 NameRegistered 事件）',
                metrics.chain.names === null ? '暂时读不到链' : metrics.chain.names,
              )}
              {row('链上不同的持有人地址', metrics.chain.owners)}
              {row('索引里的行数', `${metrics.index.names}（${metrics.index.kind === 'memory' ? '内存索引' : '数据库索引'}）`)}
              {row('其中已发布名片', metrics.namesWithCard)}

              {metrics.index.warning ? (
                <p className="body-2" style={{ fontSize: 14, opacity: 0.75 }}>
                  注意：索引跑在
                  {metrics.index.kind === 'memory' ? '内存里，服务一重启就清空' : '数据库里'}，
                  所以上面的索引数字只说明"这个进程见过什么"，不代表链上有什么。链才是完整记录。
                </p>
              ) : null}

              <p className="body-2" style={{ fontSize: 14 }}>
                自己核对：读发行合约的 <span className="mono">NameRegistered</span> 事件，
                或者在本仓库跑 <span className="mono">pnpm snapshot:names</span>。
              </p>

              <h2 className="faq-q" style={{ fontSize: 18, marginTop: 24 }}>
                还量不出来的
              </h2>
              <ul className="body-2" style={{ paddingLeft: 18 }}>
                {metrics.notMeasured.map((entry) => (
                  <li key={entry.id} style={{ marginBottom: 8 }}>
                    <strong>{GAP_ZH[entry.id]?.title ?? entry.metric}</strong>：
                    {GAP_ZH[entry.id]?.why ?? entry.why}
                  </li>
                ))}
              </ul>

              <p className="body-2" style={{ fontSize: 14 }}>
                想了解权限与风险，见{' '}
                <Link className="record-link" href="/trust">
                  信任模型
                </Link>
                ；想知道这批数字的语气边界，见{' '}
                <Link className="record-link" href="/anchors">
                  已锚定的批次
                </Link>
                。
              </p>
            </>
          )}
        </main>
        <SiteFooter config={config} />
      </div>
    </div>
  );
}
