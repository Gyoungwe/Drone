# 宿主按插件保管凭据（P4 剩余项）

日期：2026-11-06。状态：**已审核（2026-11-06）**。用户已定（2026-11-06）：0600 JSON 文件保存；凭据绑定「插件 ID + 槽位定义」；本片只做 Zotero 网页 API 密钥，本机 key 暂不做；设置页已存的 `zotero-web.json` 不迁移，用户重新填写。

## 目标

受管插件的 worker 没有环境变量，也读不到宿主文件。插件需要密钥时，只声明「哪个槽位、发往哪个主机、放在哪个请求头」，宿主在 `network.*` 发出请求时附加，插件全程拿不到明文。

## 清单声明

```json
"drone": {
  "credentials": [
    {
      "slot": "zotero-web",
      "label": { "zh": "Zotero 网页 API 密钥", "en": "Zotero Web API key" },
      "hosts": ["api.zotero.org"],
      "header": "Zotero-API-Key",
      "fields": ["libraryType", "libraryId"]
    }
  ]
}
```

- `hosts` 必须是 `permissions.network` 的子集，`header` 不能是保留头；`check-manifests` 校验。
- `fields` 是非机密参数（拼 URL 要用），插件可以读。
- 槽位定义（slot、hosts、header、fields）进入来源比较的一部分：定义变了，旧凭据不再生效，需要重新填写；只改版本号、不改槽位时凭据保留。

## 宿主

| 部分 | 做法 |
| --- | --- |
| 存储 | `agentDir/plugin-credentials.json`，`JsonStore`，`mode: 0o600`；键为 `插件 ID + 槽位定义哈希`；值为 `{ secret, fields, savedAt }` |
| 使用 | `network.read/write` 请求新增可选 `credential: "<slot>"`。宿主检查：槽位已声明、URL 主机在槽位 `hosts` 内、已保存；然后设置 `header`。插件自己设置同名头会被拒绝 |
| 查询 | 新能力 `credentials.status`（read）：返回每个槽位 `{ configured, fields }`，不含密钥 |
| 设置页 | 「插件」页每个声明了凭据的插件显示槽位表单：填写、清除。新增 IPC 按 AGENTS.md 同步 shared/preload/main/backend 与 zh/en 文案 |
| 日志 | 密钥不进日志、诊断包、错误消息 |

不做：宿主不验证密钥内容（研究包自己调 `/keys/current` 并按领域语义报告）；不做钥匙串；不做通配主机。

## 研究包（drone-plugins，独立 PR）

- 清单加上面的槽位。
- `zotero_status` 改读 `credentials.status`；Web API 请求带 `credential: "zotero-web"`，不再报 `managed-runtime-has-no-credentials`。
- 本机 key（Zotero 10 写入）仍报未配置，等以后单独做。

## 旧路径

`backend/src/zotero/web-credentials.ts` 和 `zotero-web.json` 在本片保持不动，供未切换的旧扩展使用；切换并删除 `zotero-literature.mjs` 时一起删除。

## 验收

- 单元：主机不在槽位内拒绝；未保存时拒绝；插件自设同名头拒绝；槽位定义变化后旧凭据失效；版本号变化保留；文件 0600。
- 真实 SDK + 安装的 fixture 包：worker 内拿不到密钥（`credentials.status` 无明文）；本地 HTTP 服务器收到的请求带正确头；未保存时服务器收不到请求。
- 研究包 relock 后：真实研究包的 Web API 更新走通（Zotero 仍用本地假服务器）。

## 提交顺序

1. Drone：存储 + `network.*` 附加 + `credentials.status` + 测试。
2. Drone：设置页 UI 与 IPC。
3. drone-plugins：研究包清单与工具。
4. Drone：relock，真实研究包 SDK 用例。
