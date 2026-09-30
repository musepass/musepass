# @musename/verify

履历的**离线**验证。在一台断网的机器上，给一条履历：它说的事是否成立、是谁说的、证据是不是事后补的。
不连我们的服务器，不连任何 RPC。

## 它验证什么

实现的是 **ERC-8412 草案**（*Preregistered Acceptance Criteria*），锁定在
PR [`ethereum/ERCs#2002`](https://github.com/ethereum/ERCs/pull/2002) 的 commit
`ff9fbc7e2de497d3dec2595a90b262aecd576f5d`，规范全文归档在
`docs/reference/erc-8412-ff9fbc7.md`（CC0）。草案还是 open 状态，编码随时可能变，所以钉死 commit
这件事本身是交付物的一部分，不是备注。

检查项（规则编号沿用草案）：

| 规则 | 含义 |
|---|---|
| W | 标准文档本身是否合规：义务必须从 0 连续编号、可豁免义务必须配豁免权、每类证据的必需约束键齐全、判定规则必须是标准规则或反向域名命名 |
| O1 | 证据不得早于标准登记时间；每条证据必须绑定同一个 `preregistrationId` |
| O2 | 判为 `MET` 的义务必须有覆盖它的证据，且文档层面能查的约束成立（必需采集元数据、`notBefore`、`mediaType`） |
| O3 | 判为 `WAIVED` 的义务必须有恰好一条、由 `waiverAuthority` 用 EIP-712 签名的豁免；反过来，非 WAIVED 的义务不能带豁免记录 |
| O4 | 结论必须由判定规则推出；`Indeterminate` 必须给出非空的 `undecided`，且列出的义务必须是 `UNMET` |
| O5 | 公开的三份文档必须和链上登记的摘要一一对应：criteriaDigest、bundleDigest、attestationDigest、taskRef、expiry、verifier、supersedes、义务数量、打包后的 obligationFlags、verifierConstraint |

同时实现 **锚定层**（草案没有规定，属于我们的设计）：一天的履历摘要做成默克尔树，只把根写到链上。
配对规则用 OpenZeppelin `MerkleProof` 的「先排序再哈希」，所以这里生成的证明在链上标准合约里也能验，
反过来链上生成的证明这里也能验。

## 为什么需要它

注册表只能验证「这个摘要被指定验证者签过」，别的什么都验不了。草案自带的向量里，
**有 15 份以上会被注册表接受、但被离线规则否掉**的包。这一层就是补这个洞的。

## 用法

```bash
pnpm --filter @musename/verify build

# 整个一致性向量集（23 个）
node packages/verify/dist/cli.js --vectors packages/verify/test/fixtures/erc8412

# 单个包
node packages/verify/dist/cli.js case.json
node packages/verify/dist/cli.js --chain chain.json --criteria criteria.json \
  --bundle bundle.json --attestation attestation.json
```

输出：

```json
{
  "valid": false,
  "violations": [{ "rule": "O2", "detail": "obligation 0 is MET but no bundle item covers it" }],
  "unchecked": []
}
```

退出码 0 表示结论站得住，1 表示被推翻。`unchecked` 是非空的**不算错**：那是「这个验证器判定不了」
（例如自定义判定规则），不是「这是假的」——两者的区别很重要，所以分开报。

## 一致性

`test/fixtures/erc8412/` 里的 23 个向量来自草案仓库本身（CC0），由
`node scripts/fetch-erc8412-vectors.mjs` 按钉死的 commit 拉取，附 `manifest.json`
记录 commit 与每个文件的 sha256。`test/conformance.test.ts` 逐个跑：

- 期望 `valid` 与我们的结论一致；
- 期望报告出来的规则必须都出现（多报允许，漏报不允许）。

用自己的向量测自己的实现等于没测，所以这一层专门用别人的。

## 现在的边界（写在明处，不假装能验）

- 打盐的承诺（比如地理围栏 commitment）**打不开**，只能确认它存在；
- 媒体本身不检查（照片是不是真的、有没有 P 过），草案也没要求；
- 反向域名的自定义判定规则只报 `unchecked`；
- 这套代码假设调用者拿到的是「链上那条记录」，链上状态从哪来由上层负责。

## 锚定已经跑过一次（真链）

```bash
node scripts/anchor-receipts.mjs --records deployments/receipts-genesis.json --send
```

第一笔在 Robinhood Chain 上：交易 `0xad4c4d97…`，25,898 gas，零金额、发给自己的交易，
calldata 里是 `keccak256("musename.receipts.v1") ‖ root ‖ count ‖ anchoredAt`。
不新增合约。任何人都能用链上数据独立验证：

```bash
musename-verify --anchor-data <该交易的 input data> --records deployments/receipts-genesis.json
```

genesis 批次只装了两件**已经发生**的事：`xiaoming.musepass.eth` 的领取交易和名片发布交易。
不是演示数据，脚本发完会读回交易比对，不一致就报错。

## 下一步（阶段 5 其余部分）

- 把「每天一次」做成定时任务，并加一条「今天没锚定」的告警（现在只有手动脚本）；
- 链上的 `preregister` / `attest` 注册表（草案自带参考实现未审计，规则 1 不允许直接当核心合约用）；
- the project's own engine 的验证引擎适配器；
- 认证月费的订阅与到期处理。
