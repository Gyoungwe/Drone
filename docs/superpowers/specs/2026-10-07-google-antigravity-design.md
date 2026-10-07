# Google Antigravity 内置 Provider 设计

日期：2026-10-07

## 目标

为 Drone 增加内置 `google-antigravity` provider，支持 Google 账号 OAuth 登录、Cloud Code Assist 项目发现、Antigravity 模型选择和流式文本/推理/工具调用，同时保留现有 `google` Gemini API 和 `google-vertex` provider 的行为。

这是一个正式内置、但依赖不稳定非公开协议的 provider。设置页和首次登录流程必须明确提示：协议可能变化，使用可能受到 Google 服务条款和账号策略影响。用户选择继续后才会启用该 provider。

## 研究结论

现有 OpenCode 方案普遍采用以下结构：

- 浏览器 OAuth Authorization Code + PKCE，本机 loopback 回调；无浏览器回调时粘贴授权结果。
- 以 refresh token 换取短期 access token，并自动刷新。
- 登录后调用 Cloud Code Assist 的项目发现接口取得 `cloudaicompanionProject`。
- 通过 `daily-cloudcode-pa.googleapis.com` 等 Cloud Code Assist endpoint 的 `v1internal` 路由发送请求。
- 请求带有项目、request ID、会话标识、工具配置和 Antigravity/Cloud Code Assist 兼容的请求封装。
- 模型目录包含 Gemini、Claude 和 GPT-OSS；部分思考档位通过 wire model ID 映射，另一部分通过请求体参数表达。
- 生产与 sandbox endpoint 之间有 fallback，模型发现失败不能阻断已有模型请求。

参考：[opencode-antigravity-auth](https://github.com/NoeFabris/opencode-antigravity-auth)、[oc-antigravity-provider](https://github.com/ddwalias/oc-antigravity-provider)。这些项目自己也声明该路径可能违反服务条款并导致账号受限，因此 Drone 不复制多账号轮换、额度规避或第三方明文凭证导入。

## 范围

### 包含

1. 新 provider ID `google-antigravity`，独立模型目录和协议适配器。
2. 设置页登录入口和风险提示。
3. OAuth PKCE、loopback 回调、手动粘贴回调、token 刷新和取消。
4. Cloud Code Assist 项目发现与本地凭证持久化。
5. 稳定模型的静态目录、思考档位映射和可选的登录后模型发现缓存。
6. 流式文本、推理、工具调用、正常结束和错误事件。
7. 离线 mock 测试、UI 登录测试和协议回归测试。

### 不包含

- 多账号轮换、自动切换账号或额度池聚合。
- 读取 OpenCode、Gemini CLI 或其他工具的 token 文件。
- 代理服务、远程 token 中转或把 Antigravity 暴露为公共 API。
- 修改现有 `google` / `google-vertex` provider。
- 把 Antigravity 模型伪装成普通 Gemini 模型。

## 组件设计

### Provider 与认证

在 Pi SDK provider 边界增加 `google-antigravity` provider。provider 的 auth 同时提供 OAuth 登录和 token refresh；Drone 的 `LoginService` 继续使用现有 OAuth 事件桥接，不在 renderer 中实现 OAuth。

凭证使用 SDK 已有的 `auth.json` 存储语义，provider ID 作为键。refresh token 不进入日志、trace、错误卡、模型目录或报告。认证结果只向 UI 暴露状态和脱敏错误。

OAuth 流程：

1. 生成 state、PKCE verifier/challenge 和随机 loopback 端口。
2. 打开系统浏览器到授权 URL。
3. 监听一次回调，验证 state，交换 authorization code。
4. 调用项目发现接口，保存 refresh token 与项目 ID。
5. 回调超时、用户拒绝、端口占用和取消都可重试，且不留下半成品凭证。
6. access token 到期前由 Pi SDK 按 OAuth 有效期安全窗口刷新；刷新失败显示重新登录，不静默降级到 Gemini 或 Vertex。transport 不把 refresh token 放入请求头，也不在 401 后绕过 SDK 持久化层自行刷新。

### 请求适配器

新增独立的 Antigravity transport 模块，负责：

- 选择 endpoint，并在明确的网络/服务错误时按顺序尝试 fallback。
- 从凭证获取 access token，附加 Bearer 授权和协议所需 headers。
- 将 Drone/Pi 的统一消息转换为 Cloud Code Assist 请求 envelope。
- 生成 request ID 和会话 ID，填入项目、模型、工具声明和思考参数。
- 将 SSE / JSON 流转换为 Pi 的文本、推理、tool-call、usage 和终止事件。
- 将 401、403、429、项目缺失、模型不存在、工具 schema 拒绝和协议解析错误转换为统一 UI 错误。

transport 不公开通用代理接口；它只能由该 provider 调用。

### 项目发现与模型目录

登录后使用 access token 调用项目发现；项目缺失或权限不足是 provider 的明确阻断状态。项目 ID 不从用户输入的任意字符串直接拼接请求，必须经过格式校验和脱敏存储。

首发静态模型目录只包含已验证的 Gemini 3.x、Claude 4.x 和 GPT-OSS 条目。每个条目包含：

- 逻辑模型 ID和实际 wire ID；
- 上下文与最大输出限制；
- 支持的输入模态；
- 支持的 thinking 档位；
- wire ID 映射或 body-level thinking 参数。

登录后的 `fetchAvailableModels` 只更新隔离缓存，不改变当前会话中已经选择的模型；发现失败不影响静态目录请求。

### UI

Settings → Providers 中显示 “Google Antigravity”。未登录时显示“登录”；已登录时只显示已配置和项目状态，不显示 token 或完整项目敏感信息。

登录弹窗复用现有 `LoginDialog`：

- 显示风险提示、授权链接、回调等待状态和失败原因；
- 支持取消和重新登录；
- 登录成功后刷新 provider/model 列表；
- 如果项目发现失败，保持 provider 未配置并给出下一步。

模型选择器将其作为独立 provider 分组，模型名带 “Antigravity” 标识，避免用户误选普通 Gemini API。

## 错误与恢复

- OAuth state 不匹配：拒绝回调并允许重新开始。
- callback 超时或端口不可用：提供复制 URL / 手动粘贴入口。
- token refresh 失败：清除短期 access token，保留 refresh token，提示重新登录。
- 401：提示重新登录；正常请求前的过期刷新由 SDK 完成。
- 403：区分项目权限不足与服务拒绝。
- 429：显示服务限流，不自动换账号。
- endpoint 失败：只在允许的 fallback 条件下尝试下一个 endpoint，最终保留原始错误类别。
- SSE 中断：保留已收到内容，回合显示可恢复错误；不自动重放可能产生副作用的工具调用。
- 工具 schema 被服务拒绝：在错误卡显示具体工具名和修正提示，不把请求重发到普通 Gemini。

## 测试计划

### 纯单元测试

- PKCE challenge、state 验证、回调 URL 解析和超时。
- token exchange、刷新窗口和脱敏。
- 项目发现响应解析和权限错误。
- 模型逻辑 ID → wire ID / thinking body 映射。
- envelope 构造、headers、endpoint fallback。
- SSE 文本、推理、工具调用、usage 和异常帧解析。
- 401/403/429、项目缺失、模型不存在和 schema 拒绝。

### 集成测试

使用本地 mock HTTP server，不访问 Google：

- 完整 OAuth 回调到凭证保存；
- access token 过期后的刷新；
- 项目发现后发送第一条消息；
- endpoint fallback；
- 工具调用往返；
- refresh token、authorization header 和项目 ID 不出现在日志或错误卡。

### UI 测试

- provider 出现、风险提示和登录入口；
- 浏览器授权链接、手动粘贴回调、取消和失败重试；
- 登录成功后模型列表刷新；
- provider 切换和错误卡恢复；
- 中英文 key 完整性。

### 真实冒烟

仅在本地用户明确提供自己的 Google 登录环境时执行一次：

1. 登录；
2. 选择一个 Gemini Antigravity 模型；
3. 发送纯文本请求；
4. 发送带工具声明的请求；
5. 验证刷新后仍能请求。

不保存 token、完整请求、响应正文或用户项目内容。

## 兼容与回滚

provider 是新增项。关闭或删除 Antigravity 凭证不会影响 `google`、`google-vertex` 或其他 provider。若协议发生变化，可禁用 provider 请求而保留其他模型；回滚只需移除 provider 入口和 transport，不迁移或删除用户已有的其他凭证。

## 验收标准

- 设置页能发起并取消 Antigravity OAuth。
- mock 测试覆盖 OAuth、刷新、项目发现、协议流和错误恢复。
- provider 能独立显示模型和 thinking 能力。
- Google Gemini 和 Vertex 现有测试保持通过。
- 完整 lint、typecheck、unit、build、architecture 和 extension checks 通过。
- 真实冒烟成功，或在缺少用户登录环境时明确标记为未执行，不把 mock 结果当成真实成功。
