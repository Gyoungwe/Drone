# 机构访问（合法通道）- 一次登录，自动保存模板

> 设计目标：Agent 遇到付费墙时自动请求机构登录，登录一次后自动保存 EZproxy 模板，无需手动设置，任务授权后自动下载，过期/验证码才再弹窗口。

## 架构

- **配置存储**：`~/.pi/agent/institutional.json`（用户级）
  - `ezproxyTemplate`：自动从登录 URL 识别，例如 `https://ezproxy.example.edu/login?url=%s`（用户无需手动填）
  - `openUrlResolver`：预留
  - `institutionName`：自动或展示用
  - `autoDownloadEnabled`：默认 true
  - `perTaskLimit`：每任务上限默认 20（1-100）
  - `lastLoginAt` / `lastLoginUrl`

- **会话存储**：Electron 分区 `persist:drone-institutional`
  - `session.fromPartition`，Cookie 持久在 `userData/Partitions/drone-institutional`
  - 登录窗口 `BrowserWindow` 支持 Shibboleth / CARSI / OpenAthens / WebVPN / EZproxy 完整 JS 流程
  - `net.fetch(url, { session })` 后台抓取

- **模板自动推断**（`inferEzproxyTemplateFromUrl`）：
  - 监听 `did-navigate` / `did-finish-load`
  - 若 URL 含 `ezproxy` 且 query 含 `url=https://...` → 提取到 `url=` 为止，替换为 `%s`，如 `https://ezproxy.xxx.edu/login?url=%s`
  - 通用 `?url=` / `&url=` 且值为 http(s) → 同样提取
  - 自动调用 `detectAndSaveTemplateFromUrl` 保存到配置，无需手动

## 流程（无需手动设置模板）

1. **Agent 请求**：`research_archive_source` 先走 OA，失败且机构会话未登录或过期 → 返回 `institutional_auth_required`
2. **自动登录**：Agent 自动调用 `research_institutional_login`（或用户点设置面板“登录机构账号”），打开机构浏览器窗口
   - 可传 `url` 参数（DOI 或出版社 URL），窗口会直接打开该文献页（经已有模板代理）
3. **用户登录**：在窗口完成学校/图书馆登录（CARSI 选学校、Shibboleth、OpenAthens、WebVPN、EZproxy 账号）
4. **自动保存模板**：导航到 `https://ezproxy.xxx.edu/login?url=https://www.nature.com/...` 时，自动识别并保存模板到 `institutional.json`
5. **重试下载**：Agent 再次调用 `research_archive_source`，经 `institutionalFetch`（`net.fetch` 带会话）+ 模板尝试，成功则归档 `source=institutional`
6. **上限与过期**：每任务计数 `open_access.source==institutional`，超限 → `institutional_limit_reached`；登录页检测 → `institutional_auth_required` 再次触发登录

## 工具

- `research_institutional_login`：打开登录窗口，自动保存模板，返回状态与下一步
  - 参数：`url`（可选，要访问的文献 URL）、`reason`（可选，说明）
  - 返回：`login_window_opened` + 自动识别的模板 + 指示
- `research_institutional_status`：只读状态（配置 + Cookie 数 + 是否已登录）
- `research_archive_source`：已接入机构通道，`status` 含 `institutional_auth_required` / `institutional_limit_reached`

## UI（设置 → 文献库）

- **机构访问（一次登录，自动保存模板）** 节：
  - 说明：无需手动填模板，登录后自动保存
  - 状态：登录态、Cookie 数、上次登录、自动模板（已自动识别 / 未识别）、机构名、自动下载、上限
  - 操作：登录机构账号（自动保存模板）、刷新状态、清除登录状态、测试访问（输入 DOI URL，经会话/模板尝试）
  - 工作流提示：Agent → OA 失败 → 自动调登录 → 你登录 → 自动保存模板 → 重试

## 安全与合规

- 仅用用户自己的机构 Cookie，不内置账号
- 不走 Sci-Hub，明确禁止
- 每任务上限防滥用
- 分区隔离，配置仅存模板与时间戳，不存密码

## 相关文件

- `packages/shared/src/institutional.ts`
- `packages/backend/src/institutional/{config,session,status}.ts`（含 `inferEzproxyTemplateFromUrl` / `detectAndSaveTemplateFromUrl` / `openInstitutionalLoginWindow`）
- `packages/desktop/src/main/institutional-access.ts`（复用 backend 窗口）
- `packages/desktop/src/main/ipc/institutional.ts`
- `.pi/lib/institutional-access.mjs`（JS 版，含自动推断）
- `.pi/extensions/institutional-access.mjs`（`research_institutional_login` / `research_institutional_status`）
- `.pi/lib/source-archive.mjs`（机构抓取 + 上限）
- `packages/desktop/src/renderer/src/components/knowledge/InstitutionalAccessSection.tsx`（自动模式 UI）
