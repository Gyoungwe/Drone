# Google Antigravity Provider 实施计划

> 依据：`docs/superpowers/specs/2026-10-07-google-antigravity-design.md`
> 分支：`codex/antigravity-oauth`

## 1. 在 backend 建立独立 provider 核心

**目标**：把 OAuth、凭证、项目发现和 Cloud Code Assist transport 放在 backend/session-engine 边界内，renderer 只接收现有登录事件。

**改动**：

- 新增 `packages/backend/src/session-engine/antigravity/types.ts`：
  - provider 常量、凭证附加字段、错误分类、模型目录和请求 envelope 的共享类型。
  - 脱敏错误和不向 UI/日志返回 token 的边界函数。
- 新增 `packages/backend/src/session-engine/antigravity/oauth.ts`：
  - Authorization Code + PKCE：state、verifier/challenge、loopback callback、callback state 校验。
  - 端口占用时回退随机 loopback 端口；支持粘贴完整 redirect URL 或 code 的手动回退。
  - token exchange、刷新、有效期安全窗口、Google 用户信息读取。
  - Cloud Code Assist `loadCodeAssist` / `onboardUser` 项目发现；失败分类为项目权限、账号验证、网络和取消。
  - 只返回 Pi SDK 的 OAuthCredential 形状，refresh/access/projectId/email 作为 provider 私有字段保存。
- 新增 `packages/backend/src/session-engine/antigravity/catalog.ts`：
  - 首发静态模型表，逻辑 ID 与 wire ID、thinking 映射、上下文/输出限制、图片能力。
  - 可选 `fetchAvailableModels` 动态发现，使用隔离的 models store 缓存；失败保留静态表。
- 新增 `packages/backend/src/session-engine/antigravity/{transport,request,response}.ts`：
  - Cloud Code Assist envelope、request/session/trajectory ID、工具配置和 thinking 参数。
  - production/sandbox endpoint fallback，只对网络、408、429、5xx 进行 fallback。
  - SSE 行拆分、`response` 解包、文本/推理/tool call/usage/finish/error 事件映射。
  - SDK 在请求前按 OAuth 有效期安全窗口刷新；transport 不传播 refresh token，也不在 401 后自行刷新，401 显示重新登录，避免绕过 SDK 凭证持久化边界。

## 2. 将 provider 注册到 Pi ModelRuntime

**改动**：

- 新增 `packages/backend/src/session-engine/antigravity/provider.ts`，以 `createProvider` 组装 OAuth、静态/动态模型和自定义 stream 实现。
- 修改 `packages/backend/src/session-engine/engine.ts`：创建 ModelRuntime 后调用 `registerNativeProvider`，保证所有会话、设置页和模型选择器都看到同一个 provider；避免重复注册。
- 修改 `packages/backend/src/session-engine/sdk.ts`：只通过 session-engine 边界重新导出新增 provider 类型/工厂。
- 将 `google-antigravity` 纳入 shared provider/API 类型，保持现有 `google` 与 `google-vertex` 原样。
- 登录仍走既有 `LoginService` OAuth 桥；只补充 provider-specific 的 prompt/event 文案，不在 renderer 实现认证。

## 3. 设置页和 i18n

**改动**：

- 修改 `packages/desktop/src/renderer/src/components/settings/providers/ProviderRow.tsx` 与 `LoginDialog.tsx`：
  - 对 `google-antigravity` 显示协议风险提示、项目配置状态和重新登录入口。
  - 复用现有 auth_url、manual_code、取消和错误状态，不展示凭证或完整 project ID。
- 修改 `packages/desktop/src/renderer/src/i18n/zh.ts`、`en.ts`：
  - provider 名称、风险提示、项目发现失败、账号验证和重试文案。
  - 添加中英文 key 对等检查。
- 更新 shared provider 类型注释/测试，确保新 provider 是独立分组而不是 Gemini/Vertex 别名。

## 4. 测试实现

**backend 单元测试**：

- `packages/backend/test/antigravity-oauth.test.ts`：PKCE、state、防 CSRF、回调解析、token/refresh、过期窗口、取消和错误脱敏。
- `packages/backend/test/antigravity-catalog.test.ts`：静态表、wire/thinking 映射、动态发现缓存/失败回退。
- `packages/backend/test/antigravity-transport.test.ts`：envelope、请求头、endpoint fallback、SSE 事件、usage、401/403/429/工具 schema 错误和截断流失败。
- `packages/backend/test/antigravity-provider.test.ts`：provider 注册、auth 状态和现有 Google/Vertex provider 未改变。

**desktop 测试**：

- provider row/login dialog 的 UI 状态测试：风险提示、OAuth URL、手动 code、取消、失败重试、登录后刷新模型。
- i18n key parity 测试。

**离线集成测试**：

- 本地 HTTP mock server 完成 OAuth callback → project discovery → 第一条 SSE 请求。
- 断言 authorization header、refresh token、project ID、请求正文不会写入日志、错误卡和测试报告。

## 5. 验证顺序

1. 运行新增 backend/desktop 测试。
2. 运行 `npm run lint`、`npm run typecheck`、相关 workspace tests。
3. 运行 `npm run build`、`npm run check:arch`、`npm run check:extensions`。
4. 用临时 `PI_CODING_AGENT_DIR` 和本地 mock server 做一次登录与流式请求冒烟；不使用真实 Google 凭证。
5. 如果本机存在用户明确提供的 Google 登录环境，再单独记录真实冒烟；否则报告“未执行”，不把 mock 结果当成真实成功。

## 6. 回滚边界

新增 provider 可整体删除；不修改 `google`、`google-vertex`、现有 auth.json 条目或其他模型。动态目录缓存仅使用 provider 自己的 models store 条目，删除 provider 不影响其他 provider。

## 7. 本地真实登录复核（2026-10-07）

- 使用独立的临时 agent 与 userData，通过本机 Electron 的设置页面发起 Google 登录。Google 回调和 token exchange 已成功；补入 `MACOS` 平台后项目发现返回 HTTP 400 `INVALID_ARGUMENT`。
- 原先的本地模拟服务测试仅验证 UI、模型选择和请求流；不能作为真实 Google 接入成功的证据。
- 改为 Gemini CLI 的 `IDE_UNSPECIFIED` 后，400 消失，但真实请求返回 403 `UNSUPPORTED_CLIENT`。这一步未接通，不能计为通过。
- 直接读取本机官方 Antigravity 2.19.1 的 descriptor，确认 `ANTIGRAVITY=9`、`GEMINI=2`，平台 Darwin/Linux/Windows 按架构映射到 1–5。现统一发现、开通、目录和聊天请求的 metadata 和 User-Agent；回归测试覆盖实际出站请求和各平台枚举。
- 项目错误只保留 Google 返回的机器可读 status/reason 代码；响应中的 message、账号、项目与 metadata 不进入错误提示。测试验证错误原因代码可以保留，私密响应字段不会泄漏。
- 相关测试 25 项、类型检查、构建和架构检查均通过；随后用全新的隔离目录重试真实登录与一条模型请求。
