# 机构访问（合法通道）

> 设计目标：让有机构订阅的用户登录一次后，任务授权后自动通过自己的机构权限下载闭源文献，不走盗版源，登录过期或验证码时才弹机构浏览器窗口。

## 架构

- **配置存储**：`~/.pi/agent/institutional.json`（用户级，JSON）
  - `ezproxyTemplate`：EZproxy 前缀，例如 `https://ezproxy.example.edu/login?url=%s` 或 `https://ezproxy.example.edu/login?url=`
  - `openUrlResolver`：OpenURL 解析器（可选，预留）
  - `institutionName`：展示用
  - `autoDownloadEnabled`：是否允许任务自动下载（默认 true）
  - `perTaskLimit`：每任务上限（默认 20，1-100）
  - `lastLoginAt` / `lastLoginUrl`：上次登录时间与 URL

- **会话存储**：Electron 分区 `persist:drone-institutional`
  - 通过 `session.fromPartition` 创建，Cookie、localStorage 等持久化在 `userData/Partitions/drone-institutional`
  - 登录窗口 `BrowserWindow` 使用该分区，支持 Shibboleth / CARSI / OpenAthens / WebVPN / EZproxy 的完整 JS 登录流程
  - `net.fetch(url, { session })` 用于后台自动抓取（Electron 30+）

- **代理模板逻辑**（`buildProxiedUrl`）：
  - 含 `%s` → 全部替换为 `encodeURIComponent(originalUrl)`
  - 以 `=` 结尾（如 `.../login?url=`）→ 直接追加编码 URL
  - 含 `ezproxy` 或 `login` 且有 query → 追加 `&url=编码URL`
  - 已包含目标 host → 返回 null（避免二次代理）
  - 其他 → 前缀 + 编码 URL

## 流程

1. **配置**：设置 → 文献库 → 机构访问，填 EZproxy 模板（推荐）与机构名，保存
2. **登录**：点“登录机构账号”，弹出机构浏览器窗口，完成图书馆 / IdP 登录（Shibboleth 选学校、CARSI、OpenAthens、WebVPN 均可）
3. **自动下载**：
   - `research_archive_source` 先走合法 OA（Europe PMC / PMC OA / Unpaywall / OpenAlex / Semantic Scholar / Crossref）
   - OA 失败且机构已配置且 `autoDownloadEnabled` 且 Electron 可用 → 检查每任务已用数（`sources/download-manifest.json` 中 `open_access.source === "institutional"` 的计数）
   - 若超限 → 返回 `institutional_limit_reached`
   - 否则构造候选 URL：原始 URL、OA 候选 URL、doi.org URL，分别经 EZproxy 模板与直连机构会话尝试 `institutionalFetch`
   - 成功 → 归档，`open_access.source = "institutional"`，`via = "ezproxy" | "institutional_session"`
   - 检测到登录页（HTML 含 shibboleth / login+password / openathens / ezproxy login）→ 记为 `browser_required`，继续尝试其他候选
   - 全部失败且有 `browser_required` → 返回 `institutional_auth_required`，提示用户重新登录

4. **过期处理**：`institutional_auth_required` 时，Agent 应提示“请在设置 → 文献库 → 机构访问 → 登录机构账号 重新登录”，或直接调用 `openInstitutionalLogin`

## UI

- 位置：设置 → 文献库（Zotero 面板）内新增“机构访问（合法通道）”节
- 状态：登录状态、Cookie 数、分区名、上次登录、自动下载开关、上限、EZproxy/OpenURL 配置
- 操作：保存配置、刷新状态、登录机构账号、打开 Nature 测试登录、清除登录状态、测试访问（输入任意 DOI URL，经机构会话尝试）

## 安全与合规

- 仅使用用户自己的机构账号与 Cookie，不内置任何账号
- 不走 Sci-Hub 等盗版源，`research_archive_source` 描述中明确禁止
- 每任务上限防止滥用（默认 20）
- 会话分区隔离，不影响主会话
- 配置文件仅存模板与时间戳，不存密码

## 相关文件

- `packages/shared/src/institutional.ts`：类型定义
- `packages/backend/src/institutional/{config,session,status}.ts`：配置、会话、状态
- `packages/desktop/src/main/institutional-access.ts`：登录窗口与 IPC 实现
- `packages/desktop/src/main/ipc/institutional.ts`：IPC 注册
- `.pi/lib/institutional-access.mjs`：JS 版（供 pi 扩展使用）
- `.pi/lib/source-archive.mjs`：接入机构抓取与上限逻辑
- `packages/desktop/src/renderer/src/components/knowledge/InstitutionalAccessSection.tsx`：设置面板 UI
- `docs/institutional-access.md`：本文档
