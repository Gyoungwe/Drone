# 权限设置页（设置 → 权限）

可视化编辑 **全局规则文件** `~/.pi/agent/permissions.json`（dev/预览态为 `~/.pi/agent-dev/permissions.json`）。
保存 = 校验 + 原子写文件；权限门控扩展在每次 `tool_call` 前按 mtime+size 重读（`createPermissionConfigLoader`），
所以 **保存即生效、无需重启**。

设计来源：`docs/design-example-tasks-subagent-ui-permissions.md` §C。

## 这页不做什么

- **会话权限模式**（默认 / 完全访问）仍在输入框的 `PermissionPicker`，内存态、不落盘（spec permission-mode D1）。
- **`enabled` 开关** 没有 UI（D7 隐藏逃生舱）：文件里 `enabled=false` 时页面顶部出横幅，保存永远保留文件里的原值。
- **子智能体专属权限**：子代理的工具集来自 agent 定义，不在这里。
- **工作区根管理**（`workspaces.json`）：仍手改文件。

## 页面结构

| 区块 | 字段 | 写到文件 |
|---|---|---|
| 头部 | 文件路径、缺失 / 解析失败提示、`enabled=false` 横幅 | — |
| 工作区边界 | 工作区外读取 `outside.read`、工作区外写入 `outside.write`、系统临时区 `outside.temporary`、项目内编辑自动放行 `autoApproveProjectEdits` | `outside.*`、`autoApproveProjectEdits` |
| 工具规则 | `*`（未列出的工具）、每个工具的动作选择、`bash` 模式表（↑↓ 排序、✕ 删除、添加模式、试算）、添加工具规则（已知工具 / 自定义名） | `rules` |
| 高级 | 审计日志最近 20 条（`permission-audit.jsonl`）、打开文件位置、恢复默认、放弃更改 / 保存 | — |

### 字段含义

- `outside.read` / `outside.write`：路径工具（read / ls / show_image 与 edit / write）目标落在 **全部工作区根之外** 时的动作；默认读放行、写确认（拦读不换安全只损效率）。
- `outside.temporary`：路径或删除目标落在系统临时区（`os.tmpdir()` ∪ `/tmp`）时的动作。层级：**可覆盖 ask，永不覆盖 deny**——`rm -rf /tmp/x` 之类默认免打断，但显式 deny 不会因为在临时区而放松。
- `autoApproveProjectEdits`：规则为 `ask` 的 edit / write，目标在项目根内且不在临时区时跳过审批坞。关闭后项目内改文件也弹审批。文件里的显式布尔优先；缺省时由「是否列出 edit/write 规则」推导（旧文件兼容）。
- `rules["*"]`：没有专门规则的工具一律按此动作（默认 allow，read / ls / todo 等由此放行）。
- `rules.<tool>`：单一动作，或「模式 → 动作」表。**键序即评估序，后命中生效**；bash 走命令链：`cd x && rm -rf y`、`echo $(rm -rf y)`、`bash -c "…"` 的每个候选段分别求值，**取最严**（deny > ask > allow）。

### 评估链（与 `permissions/extension.ts` 一致）

1. 规则求值（本页编辑的全部内容）：默认 → `*` → 工具动作 → 模式表后命中；bash 取命令链最严段。
2. `deny` 直接拦截（fullAccess 档降级为审计 + 放行）。
3. 临时区：`allow` 结果按 `outside.temporary` 改写。
4. 多根边界：目标在所有工作区根之外时，`allow` 结果按 `outside.read` / `outside.write` 改写。
5. 项目记忆（`workspaces.json` 的 `allowed[]`）→ `autoApproveProjectEdits` → 弹审批坞。

## 自保护

bash 模式表里的四条 **自保护模式** 锁定：

```
*permissions.json*   *workspaces.json*   *auth.json*   *trust.json*
```

- 页面：🔒 行固定在表尾，模式不可改、不可删、不可越过，动作只能 `ask` 或收紧为 `deny`。
- 后端 `validateConfig` 二次校验：缺失、设为 `allow`、或被其后的 `allow` 通配盖掉（后命中生效）都拒绝保存。
- 文件里 `bash` 写成单一动作（如 `"bash": "ask"`）时，页面会把它规范化为 `{ "*": "ask" }` + 四条自保护行。

其余校验：动作只能是 `allow / ask / deny`；**纯数字键禁止**（JS 会把纯数字属性名重排到最前，破坏键序）；空模式、重复模式（对象键会静默合并）拒绝。

## 试算

bash 模式表下方输入一条命令 → IPC `permissionSettings:probe`，用 **当前未保存的草稿** 跑同一套 `evaluateBashCommand`：
返回最终动作、最严段、命中的模式（表中高亮并给出 `#序号`），以及每个候选段的动作。

试算 **只跑规则链**：工作区边界、临时区、项目内自动放行都依赖会话目录，不在此模拟——所以 `edit` 试算 `/tmp/x` 显示 `ask`，真实会话里在项目内且开启自动放行时不会弹窗。

## 保存与冲突

- 保存携带加载时的 `mtimeMs`；磁盘 mtime 不一致（文件被手改 / 另一实例改了）→ 不写盘，页面出「文件已在外部修改」：**重新加载**（丢弃本页更改）或 **覆盖**（`force`）。
- 写入 `tmp + rename` 原子替换，旧文件保留一份 `permissions.json.bak`。
- 只写用户可见字段：`autoApproveProjectEdits` / `outside` / `rules`；`enabled` 原样带回（文件没写时不添加）。
- 恢复默认 = 写入 `DEFAULT_PERMISSION_CONFIG` 的用户可见字段（同样保留 `enabled`）。
- 文件不存在时页面按默认规则展示，保存后创建；JSON 损坏时按默认规则展示并提示，保存会覆盖损坏内容（`.bak` 留底）。

## 代码落点

```
SettingsDialog ─▶ PermissionsPanel（store 接线）─▶ PermissionsEditor（按 props 渲染）
                     │                               ├ PatternTable（数组编辑；锁定行）
                     │                               └ ProbeSummary（试算结果）
                     ├ stores/permissions.ts（快照 / 草稿 / 保存 / 冲突 / 审计）
                     └ components/settings/permissions-model.ts（规则对象 ↔ 有序数组；本地校验）
   IPC permissionSettings:load|save|reset|probe|auditTail|openLocation（main/ipc/permissions.ts）
   backend permissions/settings.ts（readPermissionSettings / writePermissionSettings / resetPermissionSettings / probePermission / readPermissionAuditTail）
           permissions/config.ts（parseConfig 显式布尔 / serializeConfig / validateConfig）
   shared  permission-settings.ts（IPC 形状 + PERMISSION_SELF_PROTECTION_PATTERNS）
```

## 测试

- backend `test/permission-settings.test.ts`：`parseConfig` 显式布尔优先；`serializeConfig` 往返稳定、按需保留 `enabled`；`validateConfig` 拒绝放松/缺失/被覆盖的自保护、非法动作、纯数字键；读写快照、`.bak`、mtime 冲突与 `force`、解析失败与恢复默认；`probePermission` 命令链 / 草稿优先 / 路径与自定义工具；审计尾部倒序与坏行跳过。
- renderer `components/settings/permissions-model.test.ts`：往返保序、自保护行归位、行编辑边界、草稿校验。
- renderer `components/settings/permissions-panel.test.ts`：三区块与锁定行渲染、保存按钮状态机、横幅 / 解析错误 / 冲突、试算结果文案。
- 冒烟 `node scripts/check-permissions-ui.mjs`：隔离 Electron 窗口里渲染真实面板（假 `window.pi`），排序 / 校验 / 保存序列化 / 试算 / 冲突 / 横幅逐项断言并截图。
- 手测：保存 `git push*` 为 `allow` 后不重启，下一条 `git push` 不弹审批；恢复默认后再次弹。
