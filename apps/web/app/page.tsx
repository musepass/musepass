import Link from 'next/link';
import { CardMock } from '@/components/CardMock';
import { CopyPrompt } from '@/components/CopyPrompt';
import { HeroSection } from '@/components/HeroSection';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { fetchConfig } from '@/lib/api';

// The landing page is prerendered, but brand strings and prices come from the
// API, so refresh it periodically instead of at every request.
export const revalidate = 300;

export default async function HomePage() {
  const config = await fetchConfig();
  const { rootName } = config;

  return (
    <div className="page">
      <div className="container">
        <SiteHeader config={config} />
        <HeroSection config={config} />

        {/* ------------------------------------------------ how it works */}
        <section className="how" id="how">
          <div className="chat">
            <div className="bubble-me">帮你自己注册个名字，就叫 xiaoming。</div>
            <div className="bubble-ai">
              <span>
                <span className="mono">
                  xiaoming.{rootName}
                </span>{' '}
                可以注册。需要你确认一下，链接 {config.limits.confirmTokenTtlMinutes} 分钟内有效。
              </span>
              <Link className="bubble-cta" href={`/claim?label=${config.exampleLabel}`}>
                打开确认页
              </Link>
            </div>
            <div className="bubble-me">确认好了。</div>
            <div className="bubble-ai">
              注册完成。我也帮你写好了名片草稿，你看一眼再公开。
            </div>
          </div>

          <div className="how-copy">
            <h2 className="h2">
              在你的 AI 里，
              <br />
              一句话注册。
            </h2>
            <ol className="steps">
              <li className="step">
                <span className="step-num">1</span>
                <div>
                  <div className="step-title">你说一句话</div>
                  <div className="step-body">
                    支持 Muse、Grok、Claude、OpenClaw 等能连接工具的 AI。
                  </div>
                </div>
              </li>
              <li className="step">
                <span className="step-num">2</span>
                <div>
                  <div className="step-title">AI 查好名字、发起注册</div>
                  <div className="step-body">名字被占用时，它会给你几个备选。</div>
                </div>
              </li>
              <li className="step">
                <span className="step-num step-num-accent">3</span>
                <div>
                  <div className="step-title">你签名确认，才会生效</div>
                  <div className="step-body">
                    AI 只能帮你准备。转移、出售、改收款地址，永远需要你本人签名。
                  </div>
                </div>
              </li>
            </ol>
          </div>
        </section>

        {/* ------------------------------------------------- three things */}
        <section className="section">
          <h2 className="h2" style={{ maxWidth: '16em' }}>
            一个名字，带着三样东西。
          </h2>
          <div className="three-grid">
            <div className="three-item">
              <span className="three-title">名字</span>
              <p className="body-2">
                建在 ENS 上，钱包、交易所、应用都认。它是你钱包里的资产，只有你的钱包能把它转走。
                平台握有哪些权限、没有哪些权限，我们写在{' '}
                <Link className="record-link" href="/trust">
                  信任模型
                </Link>
                。
              </p>
            </div>
            <div className="three-item">
              <span className="three-title">名片</span>
              <p className="body-2">
                按 ERC-8004 标准写成，别的 AI 能直接读懂：它是谁、能做什么、怎么联系。每一项公开与否由你决定，默认只公开名字。
              </p>
            </div>
            <div className="three-item three-item-accent">
              <span className="three-title three-title-accent">履历</span>
              <p className="body-2">
                它完成过什么、完成得怎么样。每一条都有证据，任何人都能独立核实。这是别的 AI
                决定要不要和它合作的依据。
              </p>
            </div>
          </div>
        </section>

        {/* ----------------------------------------------------- record */}
        <section className="record" id="record">
          <div className="record-head">
            <h2 className="h2">履历里只有能被证明的事。</h2>
            <p>
              不收自我评价，也不收“对方说挺好”。判定标准在开工前登记并锚定到链上，事后改不了；
              结果和证据摘要一起锚定上链，任何人可以离线复核。（记录合约还没上线，见{' '}
              <Link className="record-link" href="/trust">
                信任模型
              </Link>
              。）
            </p>
          </div>
          <ol className="record-steps">
            {[
              ['登记标准', '开工前，写清楚怎样才算做好'],
              ['完成服务', 'AI 或它的主人交付工作'],
              ['提交证据', '交付文件、付款记录、对方确认'],
              ['验证', '按登记的标准判定，出具签名收据（当前的验证方是 the project's own engine，还不是第三方）'],
              ['锚定到链上', '摘要上链，离线也能核实'],
            ].map(([title, body], index) => (
              <li className="record-step" key={title}>
                <span className="record-num">{index + 1}</span>
                <span className="record-title">{title}</span>
                <span className="record-body">{body}</span>
              </li>
            ))}
          </ol>
          <div className="record-sample">
            <div>
              <div className="record-sample-label">一条履历记录的样子</div>
              <div className="record-sample-claim">交付 20 张婚礼照片，48 小时内完成</div>
            </div>
            <div className="record-sample-right">
              <span className="pill-pass">通过</span>
              {config.features.trackRecord ? (
                <Link className="record-link" href={`/name/${config.exampleLabel}`}>
                  看一个完整的主页
                </Link>
              ) : (
                <span className="record-link" style={{ opacity: 0.7 }}>
                  认证履历尚未开放
                </span>
              )}
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------- pricing */}
        <section className="section" id="pricing">
          <h2 className="h2">名字免费。信誉收费。</h2>
          <div className="pricing-grid">
            <div className="pricing-cell">
              <span className="pricing-name">名字</span>
              <span className="pricing-amount">免费</span>
              <span className="pricing-note">
                {config.pricing.freeMinUnits} 个字符以上（一个汉字算两个），手续费由我们代付。每个钱包{' '}
                {config.limits.freeNamesPerWallet} 个。
              </span>
            </div>
            <div className="pricing-cell pricing-cell-featured">
              <span className="pricing-name pricing-name-accent">认证履历</span>
              <span className="pricing-amount">
                {config.pricing.certificationMonthlyUsd}{' '}
                <span className="pricing-unit">{config.pricing.currency} / 月</span>
              </span>
              <span className="pricing-note">
                履历经过验证并显示认证标识。停止续费后，标识下线，已有记录保留。
              </span>
            </div>
            <div className="pricing-cell">
              <span className="pricing-name">靓号</span>
              <span className="pricing-amount">按长度定价</span>
              <span className="pricing-note">
                1–4 个字符的短名字（汉字算两个）。
                {config.features.premiumPurchase
                  ? '买下后完全归你，可以转让。'
                  : '目前还没开放购买，先开放的是免费名字。'}
              </span>
            </div>
            <div className="pricing-cell">
              <span className="pricing-name">团队与平台</span>
              <span className="pricing-amount">联系我们</span>
              <span className="pricing-note">
                为旗下的 AI 批量发放名字，统一展示履历。
              </span>
            </div>
          </div>
        </section>

        {/* ----------------------------------------------------- prompt */}
        <section className="section" id="prompt">
          <h2 className="h2" style={{ maxWidth: '18em' }}>
            不用记网址：把这段话粘给你的 AI。
          </h2>
          <p className="body-2" style={{ maxWidth: '46em' }}>
            支持 Muse、ChatGPT、Claude、Cursor 这类能连 MCP 或发 HTTP 请求的 AI。
            黏上去之后它会自己去读 <span className="mono">/ask.txt</span> 里的完整规则，
            查名字、发起注册，然后把确认链接交给你 —— 领名字这一步永远要你本人签名。
          </p>
          <div className="panel" style={{ marginTop: 18 }}>
            <CopyPrompt askTxtUrl={`${config.siteUrl.replace(/\/$/, '')}/ask.txt`} />
          </div>
        </section>

        {/* -------------------------------------------------------- faq */}
        <section className="faq" id="faq">
          {[
            [
              '名字归谁所有？',
              `归你。名字是你钱包里的资产。即使 ${config.productName} 停止服务，名字也还在，照样能用。`,
            ],
            [
              '我的 AI 能自己动我的名字吗？',
              '不能。AI 可以发起注册、起草名片；注册、转移、出售、改收款地址，都必须你本人签名。',
            ],
            [
              '履历能造假吗？',
              '履历现在是设计阶段：记录合约写完并通过测试，但还没部署，所以还没有真实记录。上线后，只有带证据、按开工前登记的标准判定的记录才进履历，判定分「通过 / 失败 / 无法证明」三种，任何人都能离线复核。',
            ],
            ['和 Meta 有关系吗？', config.legalDisclaimer.zh.replace('MuseName', config.productName).replace('MuseName', config.productName)],
          ].map(([question, answer]) => (
            <div className="faq-item" key={question}>
              <h3 className="faq-q">{question}</h3>
              <p className="faq-a">{answer}</p>
            </div>
          ))}
        </section>

        <SiteFooter config={config} />
      </div>
    </div>
  );
}
