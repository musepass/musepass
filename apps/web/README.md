# apps/web

阶段 1 待做。页面清单（任务书）：

1. 领取页：查可用性 → 连接钱包或创建嵌入式钱包 → 主人签名 → 代付发放
2. 公开主页：每个名字一个页面，展示名字、地址；阶段 2 之后加名片与履历
3. 管理页：阶段 2 起主人签名后编辑名片

页面必须显式写明「与 Meta 及其任何产品无关」，文案取自 `config/brand.json` 的 `legalDisclaimer`。

签名用的 EIP-712 类型与域名在 `packages/core/src/signature.ts`，与链上 `hashRegister()` 已实测逐字节一致（见技术核实报告 F8）。
