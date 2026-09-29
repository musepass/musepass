import Link from 'next/link';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { fetchConfig } from '@/lib/api';

export const metadata = { title: '信任模型' };
export const revalidate = 3600;

/**
 * The page a buyer reads before believing anything else on the site.
 *
 * Everything here is copied from `docs/trust-model.md` and is kept honest by
 * `scripts/check-public-claims.mjs`: while the registry admin is a hot wallet,
 * the claim we are not allowed to make is listed here, as a denial, on purpose.
 */
export default async function TrustPage() {
  const config = await fetchConfig();
  return (
    <div className="page">
      <div className="container">
        <SiteHeader config={config} />
        <main className="narrow">
          <h1 className="h2">信任模型：谁能做什么</h1>
          <p className="body-2">
            这一页把缺点写在明处。用户的钱包决定名字归谁；平台握着代付 gas、发行，
            以及一条我们本来不打算公开的权限 —— 注册表管理员是运营热钱包，它可以把自己加进
            registrar 名单，而 registrar 能改写任意名字的地址记录。
          </p>

          <h2 className="h3">1. 今天为真的事</h2>
          <ul className="body-2">
            <li>
              名字的归属由用户钱包的签名决定：发行合约要求受益人本人签名，签名过的 label
              不能换成别的名字或别的人。平台代付 gas，但拿不到名字。
            </li>
            <li>注册表没有 burn、没有管理员转移，平台没有直接收回或转走名字的接口。</li>
            <li>
              解析在真实主网生效（<code className="mono">xiaoming.{config.rootName}</code>{' '}
              解析到用户地址），网关在 RPC 失败时返回错误，不会签一个空答案。
            </li>
          </ul>

          <h2 className="h3">2. 今天为假的事（所以我们不写）</h2>
          {/* claims-allow-block: name-not-modifiable — this section lists the claims we do NOT make */}
          {/* claims-allow-block: platform-cannot-modify — same reason */}
          {/* claims-allow-block: record-not-modifiable — same reason */}
          <ul className="body-2">
            <li>
              <strong>「平台无法修改你的名字」</strong>：2026-09-29 链上实测，
              注册表管理员是运营热钱包 <code className="mono">0x66F499e8…</code>，
              它可以调用 <code className="mono">addRegistrar</code> 把自己加进名单（不 revert），
              registrar 能改写任意名字的地址与文本记录。权限没有转走之前，这句话不成立。
            </li>
            <li>
              <strong>「独立验证」</strong>：目前唯一的验证方是我们自己的 the project's own engine 引擎，
              属于同一个团队。我们不说独立验证。
            </li>
            <li>
              <strong>「记录不可修改」</strong>：只增不改的记录合约还没有上线，
              现在链上只有一笔把摘要根写进 calldata 的零金额自转账（见{' '}
              <Link className="record-link" href="/anchors">
                已锚定的批次
              </Link>
              ）。
            </li>
          </ul>
          {/* claims-allow-end: * */}

          <h2 className="h3">3. 那条权限的补偿措施</h2>
          <p className="body-2">
            项目方决定暂时不把管理权限迁到多签，改为把「被滥用」变成可检测事件：
            任何人可以跑{' '}
            <code className="mono">node scripts/security-power-inventory.mjs</code>，
            它读链上状态，只要热钱包变成 registrar 就退出码 1。
            攻击者的第一步就是这一步，而正常业务永远不需要它 —— 所以这个告警误报率为零，
            代价是只能在第一步之后发现，不能阻止第一步。
          </p>

          <h2 className="h3">4. 这条权限什么时候消失</h2>
          <p className="body-2">
            把注册表管理员、发行合约 owner、解析器 owner 转给硬件钱包或多签（外部签名人参与），
            热钱包只留代付一个角色，然后公开转出的交易哈希。做到之后，第 2 节第一条会从这一页删掉 ——
            在这之前它会一直在这里。
          </p>

          <p className="body-2" style={{ opacity: 0.75 }}>
            没有值班表，也没有 SLA。这是单机项目，写在这里是为了不让人以为有。
          </p>
        </main>
        <SiteFooter config={config} />
      </div>
    </div>
  );
}
