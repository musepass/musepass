# @musename/verify

阶段 5 待做。履历收据的**离线**验证。

要求（任务书）：在一台断网的机器上，输入一条履历记录，就能验证签名、判定标准哈希与锚定证明 —— 不依赖我们的服务器。

计划实现：

1. 读取一条记录（`subject / claim / criteria_hash / evidence / verdict / issuer / signature / anchor`）
2. 用 `issuer` 的地址恢复签名，校验签名覆盖的字段集合
3. 重算 `criteria_hash`，与事前登记的标准比对（标准本身不可修改）
4. 校验默克尔证明，证明该记录属于写入 Base 的某个根
5. 任一字段被篡改即报错

判定标准与逐条对账编码按 ERC-8412 草案（PR #2002）实现，**实现前必须先锁定该 PR 的 commit**，见技术核实报告 F6。
