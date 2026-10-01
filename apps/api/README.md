# @musename/api

查询 API 与注册后端。链上是事实来源，数据库只是索引和缓存。

## 接口

| 方法 | 路径 | 阶段 | 说明 |
|---|---|---|---|
| GET | `/healthz` | — | 存活与配置自检 |
| GET | `/v1/names/{name}/available` | 1 | 查名字是否可用、是否合规；不可用时给 3 个建议 |
| GET | `/v1/names/{name}` | 1–5 | 名字、所有者；名片与履历在阶段 2/5 前**返回 null，不编造** |
| POST | `/v1/names/claim` | 1 | 网页领取：校验主人签名 → 检查配额 → 代付发放 |

`{name}` 既接受标签（`aguang`）也接受全名（`aguang.musepass.eth`）。

### 统一返回约定

每个返回都是：

```jsonc
{
  "summary": { "zh": "一句话大白话结论", "en": "one sentence" },
  "data": { /* 结构化数据 */ },
  "errors": [{ "code": "RESERVED_NAME", "message": "..." }],
  "meta": { "asOf": "2026-09-29T00:00:00.000Z", "chain": "base", "chainId": 8453, "verified": true, "root": "musepass.eth" }
}
```

- 先给结论再给数据，方便 AI 直接转述给用户。
- `meta.verified` 表示这次返回是否包含链上核实结果。链上读不到时它是 `false`，不会伪装成成功。
- 需要主人签名的操作，没有有效签名一律拒绝，且**先验签名再做任何副作用**。

### 领取流程（POST /v1/names/claim）

```
1. 校验 EIP-712 签名（label + owner + deadline 都在签名里）
2. 归一化 + 政策校验 + 链上可用性（registrar.isAvailable）
3. 幂等：同一所有者重复请求直接返回已注册结果
4. 配额：单钱包免费数、单日代付、全平台代付
5. 提交交易（平台发行账户付 gas，所有权直接给签名者）
6. 写索引 + 记代付流水
```

任一步失败都不会产生链上副作用，并返回可读原因。

## 运行

```bash
pnpm --filter @musename/core build     # API 的类型来自 core 的 dist
cp ../../.env.example ../../.env
pnpm dev
```

没有 `MUSENAME_ISSUER_KEY` 时只读接口可用，领取接口返回 503，不会假装成功。

## 数据

- `sql/001_init.sql`：完整数据模型（names / cards / criteria / records / anchor_batches / subscriptions / sponsorship_ledger / abuse_reports / api_usage）
- `src/repositories/memory.ts`：当前使用的内存索引（测试与本地）
- Postgres 实现见私有工作区笔记（不入库）

## 测试

```bash
pnpm test
```

22 个用例，覆盖：可用性查询、保留名单理由与申诉提示、建议名单自身也过政策、签名来源错误、标签被换、过期重放、已占用、幂等、配额、链上失败不留副作用、限流、未配置时的 503、以及「不编造名片与履历」。

测试通过 `vitest.config.ts` 的别名直接对 `packages/core/src` 运行，避免 dist 过期导致测试说谎。
