# apps/gateway

阶段 1 待做。CCIP-Read（ERC-3668 / ENSIP-10）解析网关，让主网钱包能解析 Base 上的名字。

Durin 仓库自带一个 Cloudflare Worker 形态的网关（`gateway/` 目录，使用 `wrangler`），任务书允许「如方案自带则只做配置」。计划：

1. 基于 Durin 网关，把 Base 加进 `gateway/src/ccip-read/query.ts` 的链配置
2. 至少两个实例，前面挂健康检查
3. 监控：可用率 ≥ 99.9%、95% 请求 < 300ms，任一异常 5 分钟内告警
4. 书面故障预案：网关宕机、代付钱包余额耗尽、签名密钥泄露

在网关跑起来并接入监控之前，任务书里「解析网关可用率」这条验收**不能算通过**。
