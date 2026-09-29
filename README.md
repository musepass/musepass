# MuseName

给每个个人 AI 一个可以带着走的名字、一张公开名片和一份可验证的履历。

名字建在 ENS 上（自有根名字下的子名字，ERC-721），名片按 ERC-8004 生成，履历由 the project's own engine 验证引擎出具可独立核实的收据。**我们不重新发明域名系统，我们做名字背后的信誉。**

产品定义见《MuseName Pitch》，本仓库只负责「怎么做、做到什么程度算完成」，对应《MuseName 开发任务书》。

---

## 现在到哪一步了

| 阶段 | 内容 | 状态 |
|---|---|---|
| 0 | 前置决策与准备 | ✅ 完成；品牌、域名、根名字均已落地并记录 |
| 1 | 名字：**能在真实钱包里解析** | ✅ **已上线**：根名字 `musename.eth` 在以太坊主网，L1 解析器已部署并登记，`xiaoming.musename.eth` 在真实主网解析到 `0x603b8B1f…`；OKX Wallet 人工验证通过，机器侧 17/17 |
| 2 | 名片 | ✅ 闭环跑通并**真链验证**（Robinhood Chain，6 项断言）；待 ERC-8004 身份登记（规范仍是 Draft） |
| 3 | AI 一句话注册（MCP） | ✅ 5 个工具、HTTPS、限流、接入说明齐备；客户端菜单路径待人工实测 |
| 4 | 两周验证期（门槛） | ⬜ **未开始，缺真实用户**——这是现在唯一真正挡住「这是产品」的东西 |
| 5 | 认证履历 | 🟡 离线验证与锚定已完成（ERC-8412 草案自带 23 个向量全过；真链锚定一笔）；链上登记合约未做 |
| 6 | 靓号 / 信誉查询 / 企业命名空间 | ⬜ 未开始（价格是配置里的占位值） |

链的选择：**Robinhood Chain（4663）**，不再是 Base。ENS 在主网，所以是「主网解析器 + L2 注册表」的双链结构，
细节见 [评审包](docs/review/README.md)。

阶段 4 是门槛：两周数据不达标，阶段 5 之后不开发。

---

## 一键验证

```bash
pnpm install                 # 一键安装
pnpm check                   # 类型检查 + 单元测试 + 合约测试 + 对外文案检查（2026-09-29 实测 435 单元 + 65 合约）
pnpm verify:local            # 起本地链 + API + MCP + 网页，跑通整条链路
pnpm l1:resolver             # 主网解析器状态（只读）
pnpm verify:vectors          # 用 ERC-8412 草案自带的 23 个一致性向量跑我们的验证器
pnpm wallet:compat           # 17 项钱包兼容性检查（viem + ethers × 4 个 RPC + ERC-3668 全轮）
pnpm health                  # 线上 15 项健康检查（外部视角）
pnpm claims:check            # 对外文案是否说了链上不成立的话（会失败的那种检查）
pnpm hygiene --history       # 私网地址 / 机器名 / 本机密钥是否进了仓库（含全部历史）
pnpm snapshot:names          # 从链上导出全部名字 + sha256，用于「昨天的名单」可核对
pnpm power:inventory         # 热钱包有没有被加成 registrar（是就退出码 1）
pnpm review:package          # 生成评审用合集 docs/review/all-in-one.md
```

`pnpm verify:local` 会真的部署合约、铸造一个名字、起 API、起 MCP、起网页，然后断言：

- 链下算出的 EIP-712 摘要与链上 `hashRegister()` **逐字节一致**
- 名字归属于**签名者本人**，代付 gas 的平台地址不是 owner
- 平台地址不是 registrar（只说明它今天不在名单里；它同时是注册表 admin，可以把自己加进去 —— 见 [信任模型](docs/trust-model.md)）
- 链上地址记录按 ENSIP-11 与 mainnet coinType 各写一条
- 接着启动 API 与 MCP：AI 客户端通过 streamable HTTP 列出并调用 5 个工具，拿到一条待主人确认的注册链接
- 最后启动网页：首页、领取页、名字主页、开发者页都能渲染，品牌与价格来自 API 配置

不需要任何测试网资金，也不需要私钥。

只看网页：

```bash
pnpm --filter @musename/core build
pnpm --filter @musename/api build
pnpm --filter @musename/web dev        # http://localhost:3000
```

网页向 `MUSENAME_API_URL`（默认 `http://localhost:3001`）取配置；API 没起也能渲染，用的是内置兜底配置。

---

## 仓库结构

```
config/             品牌名、价格、限额、保留名单（全部配置化，代码零硬编码）
packages/core/      归一化、易混淆检测、保留名单、价格、namehash、名片、签名校验
packages/verify/    履历离线验证脚本（阶段 5）
contracts/          Foundry 工程：发行合约 + 记录注册表（只增不改、无资金）+ 部署脚本 + 65 个测试
apps/web/           网页：首页、领取页、确认页、名字主页（Next.js）
apps/api/           查询 API + 注册后端 + 注册请求（已完成）
apps/mcp/           MCP 服务：5 个工具（已完成）
apps/gateway/       CCIP-Read 解析网关：ERC-3668、响应签名、指标、健康检查（已完成）
scripts/            端到端验证脚本
docs/               技术核实报告、参考资料
TODO.md             后续所有阶段的工作清单
```

## 关键设计决策

### 名字是什么

根名字 `musename.eth`（**已购买，2027-09-29 到期，owner `0x022Ce19a…`**）下的 ENS 子名字，部署在 Robinhood Chain 上，每个名字是一个 ERC-721。主网通过 CCIP-Read（ERC-3668 / ENSIP-10）解析回 L2，解析器是 `0x9Ea7A889…`。

链上部分全部使用现成方案：[`ensdomains/durin`](https://github.com/ensdomains/durin)（注册表、L1 解析器、网关）。我们只写中间的服务层和用户体验。

### 为什么有一个自写合约

见 [技术核实报告 F2](docs/tech-verification-report.md)。一句话：Durin 把 registrar 权限定义为「可改写任意节点记录」，如果把这权限给平台热钱包，平台就能改用户的名字 —— 那是产品信任的底线问题。

`contracts/src/MuseNameRegistrar.sol` 因此把 registrar 权限收进合约，只暴露一个 `register()`，且要求受益人本人的 EIP-712 签名。它不持有资金、不托管名字、无升级入口，但**阶段 6 涉及资金前必须完成外部审计**。

### 资产归属

- 名字的所有权在用户钱包里。注册表没有 burn、没有管理员转移，平台没有直接收回名字的接口。
- 但**注册表 admin 是运营热钱包**：2026-09-29 链上实测，它可以调用 `addRegistrar`
  把自己加进名单（不 revert），而 registrar 能改写任意名字的地址与文本记录。
  这条权限没有转走（项目方决定先做检测而不是迁移），检测脚本是
  `node scripts/security-power-inventory.mjs --watch`。完整说明见
  [docs/trust-model.md](docs/trust-model.md)。
- 平台今天能做的：代付 gas、按规则发放、在权限被滥用时被看门人发现。
- 根名字由硬件钱包或多签持有，**服务端不持有该私钥**。

### 长度与合规

- ENSIP-15 规范化，不合规直接拒绝（不是注册后解析失败）
- 长度按**显示宽度**计算：中文算 2 列，所以「阿光摄影」是普通免费名字而不是靓号（可配置切回码点）
- 链上字节上限 255，中文名上限 85 字
- 保留名单按归一化标签比对，并额外拦截 `g00gle`、`adm1n` 这类数字替换伪装

### 代付与配额

每个用户、每天、全平台三级上限，全部来自 `config/limits.json`。签名密钥与代付钱包分离，都不进代码仓库。

---

## 配置

所有品牌、价格、限额、名单都在 `config/`：

| 文件 | 内容 |
|---|---|
| `brand.json` | 产品名、根名字、免责声明（改品牌名不需要改代码） |
| `chains.json` | 链 ID、合约地址、USDC 地址 |
| `pricing.json` | 免费档门槛、靓号分档价格、认证月费 |
| `limits.json` | 免费额度、代付上限、长度规则、保留策略 |
| `reserved-names.json` | 保留名单（品牌 / 平台 / 公众人物 / 敏感词 / 系统词） |

环境变量只用来覆盖链上地址和密钥，模板见 `.env.example`。

## 文档

- **[评审包](docs/review/README.md)** — 给外部评审：现状、链上事实、信任模型、缺口，以及希望被判断的 15 个问题（合集版 `docs/review/all-in-one.md`）
- [技术核实报告](docs/tech-verification-report.md) — Durin、ERC-8004、ERC-8412、ENSIP-15 的实际查证结果，以及必须调整的地方
- [需求验证](docs/demand-validation.md) — 阶段 4 门槛的可证伪测试；以及"平台自己做"这条风险已经发生了的部分
- [前端对接文档](docs/frontend-integration.md) — 冻结的后端契约：接口、EIP-712 签名、错误码、首页设计稿的状态映射
- [决策记录](docs/decisions.md) — 官网域名、ENS 根名字、名字主页域名等产品边界决定
- [网关运维手册](docs/runbook-gateway.md) — 协议细节、部署步骤、三种故障预案
- [状态页](docs/status.md) — 还差什么，一页看完
- [主网记录](docs/remaining-mainnet-steps.md) — 三笔交易的完整记录与自行复核方法
- [钱包兼容性](docs/wallet-compat/README.md) — 机器证据 + 人工验证清单
- [TODO.md](TODO.md) — 阶段 2–6 的工作清单
- [contracts/README.md](contracts/README.md) — 合约与部署流程

## 免责声明

MuseName 是独立项目，与 Meta 及其任何产品无关。
