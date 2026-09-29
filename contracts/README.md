# contracts

按任务书，这个目录「只放部署脚本与配置，不放自写合约」。

实际有一个例外，原因见[技术核实报告 F2](../docs/tech-verification-report.md)：Durin 把 registrar 权限定义为「可改写任意节点记录」。任务书的规则是「平台不应能修改或转走用户已拥有的名字」，所以这权限不能给平台热钱包。因此 registrar 权限收进一个合约，它不持有资金、不托管名字、无升级入口。

<!-- claims-allow-block: platform-cannot-modify — the point of this paragraph is that the claim is false -->
**这个合约做到的是「这个合约不能改」，不是「平台不能改名字」。** 注册表 admin 是运营热钱包 `0x66F499e8…`，
2026-09-29 链上实测它可以 `addRegistrar` 把自己加进名单（不 revert），而 registrar 能改写任意名字的
地址与文本记录。项目方决定暂时不迁移权限，改为把「被滥用」变成可检测事件：`node scripts/security-power-inventory.mjs --watch`。
完整说明见 [信任模型](../docs/trust-model.md)。
<!-- claims-allow-end: platform-cannot-modify -->

## 目录

```
src/MuseNameRegistrar.sol        唯一的自写合约（无资金，需审计后才能承接付费档）
src/interfaces/IL2Registry.sol   Durin 接口的 vendored 子集（不跟随上游漂移）
script/DeployMuseNameRegistrar.s.sol   生产部署脚本
script/DeployLocalStack.s.sol          本地全栈（含本地 mock 注册表）
script/mocks/LocalL2Registry.sol       仅本地使用，禁止部署
test/MuseNameRegistrar.t.sol           33 个测试（其中 10 个是 2026-09-29 新增的名字形状检查）
```

## 测试

```bash
forge test -vv
```

覆盖：创建归属、地址记录、签名来源错误、标签/受益人篡改、过期、可塑性签名（s 翻转）、保留名单（含批量取消保留）、最小长度、重复注册、非中继者调用、管理员函数权限、ENS namehash 一致性、EIP-712 domain 一致性。

## 生产部署流程

1. 在 [durin.dev](https://durin.dev) 部署 L2 注册表（Base），记下地址。
2. 把根名字的 L1 解析器指向 Durin 的 L1Resolver，并调用 `setL2Registry(registry, chainId)`。这一步需要根名字所有者的硬件钱包/多签签名。
3. 填好 `contracts/.env`（模板见 `.env.example`），其中 `MUSENAME_REGISTRAR_OWNER` 必须是多签，不是部署者。
4. `forge script script/DeployMuseNameRegistrar.s.sol --rpc-url $BASE_RPC_URL --broadcast`
5. 用注册表管理员调用 `L2Registry.addRegistrar(<registrar 地址>)`。
6. 用 registrar owner 调用 `setRelayer(<发行账户>, true)`。
7. 把 `registrar` 地址写回 `config/chains.json` 或环境变量 `MUSENAME_REGISTRAR`。
8. 用 `cast call` 复核：`registrars(<平台热钱包>)` 必须是 `false`。

第 8 步是硬性检查：平台热钱包永远不应该出现在 registrar 名单里。

## 本地全栈

```bash
anvil
forge script script/DeployLocalStack.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
```

或用仓库根目录的 `pnpm verify:local`，它会自动起链、部署、签名、铸造并断言全过程。
