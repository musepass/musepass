# @musename/signer

**给 agent 的一个钱包，但不给它私钥。**

## 它解决什么问题

一个云端 agent（Grok bot、ChatGPT、任何跑在别人机器上的 bot）**不能持有私钥**：

- 把私钥发进聊天 = 已经泄露（聊天记录、平台日志、训练数据都可能留下它）
- 就算发了，bot 也没有钱包工具去签，只能"看着"

所以正确做法是：agent 不拿钥匙，而是**请求一个它有权限访问的签名服务**。这个服务就是那个签名服务。

## 它只做三件事

| 工具 | 作用 |
|---|---|
| `wallet_address` | 告诉 agent 该用哪个地址（私钥永不返回） |
| `sign_registration` | 对 `prepare_registration` 给的 EIP-712 数据签名 |
| `sign_card` | 对 `prepare_card` 给的 32 字节哈希做 personal_sign |

## 它会拒绝什么（这比它能签什么更重要）

能被 agent 触达的签名服务，本质上是"签名预言机"：被提示词注入的 agent 会请求错误的签名。
所以策略很窄，而且是**纯函数**，不依赖密钥、网络或 agent 就能测：

- **别的链** → `WRONG_CHAIN`（只签配置里那条链）
- **别的合约** → `WRONG_CONTRACT`（只签我们自己的发行合约）
- **别的消息类型** → `WRONG_TYPE`
- **过期的截止时间 / 超过一小时** → `EXPIRED` / `DEADLINE_TOO_FAR`
- **不是 32 字节的哈希** → `BAD_PAYLOAD`
- **超过每小时上限** → `RATE_LIMITED`

**诚实的边界**：32 字节哈希本身不带出处，这个服务无法分辨"真名片哈希"和攻击者自己构造的哈希。
风险由"这把钥匙几乎不持资产"兜底——注册的 gas 是平台付的，不从这个钱包走。

## 部署与配置

```
MUSENAME_SIGNER_TOKEN        必填，至少 16 字符；没有它进程直接拒绝启动
MUSENAME_SIGNER_KEY          私钥，只从环境变量读，不写日志
MUSENAME_SIGNER_PORT         默认 8804
MUSENAME_SIGNER_MAX_PER_HOUR 默认 60
MUSENAME_CONFIG_DIR          读取 config/*.json 的目录
```

线上：`https://musepass.xyz/signer/mcp`，请求头 `Authorization: Bearer <token>`。
健康检查 `GET /signer/healthz` 只暴露地址和上限，不暴露密钥。

## 怎么用（agent 视角）

1. 连两个 MCP 服务：MusePass 主服务 + 这个签名服务
2. `wallet_address` 拿到地址
3. `check_name` → `prepare_registration`（ownerAddress 用上一步的地址）
4. `sign_registration` 签名 → `submit_registration` 提交
5. 名片同理：`prepare_card` → `sign_card` → `submit_card`

完整流程有可执行证明：`node scripts/agent-signer-probe.mjs`（不需要任何私钥）。

## 这不是长期方案

私钥在服务端意味着**托管**，和"开放、可核实"的定位有张力。长期方案是用户自己的嵌入式钱包
（见 `docs/embedded-wallet.md`）：钥匙在用户设备上，我们只拿到地址。
这个签名服务是给**agent 自己**用的：它没有设备、没有浏览器，只有一个 HTTP 客户端。

轮换方式：重新生成 token 与密钥、更新服务器 env、重启服务；旧 token 立即失效。
