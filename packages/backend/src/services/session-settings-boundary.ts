import type {
	ContextManagerMode,
	PermissionAuditTailEntry,
	PermissionMode,
	PermissionProbeInput,
	PermissionProbeResult,
	PermissionSettingsSaveInput,
	PermissionSettingsSaveResult,
	PermissionSettingsSnapshot,
} from "@drone/shared";
import { getAgentDir } from "../session-engine/engine";
import { readChannelWatchEnabled, writeChannelWatchEnabled } from "../tools/channel-watch";
import { readContextManagerMode, writeContextManagerMode } from "../tools/context-evaporation";
import type { PermissionSettingsService } from "./permissions";
import type { SessionPermissionService } from "./session-permissions";

export interface SessionSettingsBoundaryHost {
	readonly permissions: PermissionSettingsService;
	readonly sessionPermissions: SessionPermissionService;
	log: {
		info: (message: string, ...args: unknown[]) => void;
		error: (message: string, ...args: unknown[]) => void;
	};
}
export class SessionSettingsBoundary {
	constructor(private readonly host: SessionSettingsBoundaryHost) {}
	/** 权限门控配置（enabled 解析保留；UI 已无开关入口，仅手改 permissions.json 可关 = 隐藏逃生舱） */
	/** @deprecated 通过 BackendServices.permissions.getConfig 使用。 */
	getPermissionConfig(): { enabled: boolean } {
		return this.host.permissions.getConfig();
	}

	/** 设置 → 权限：规则文件快照（路径 / 原文 / 默认合并视图 / mtime） */
	/** @deprecated 通过 BackendServices.permissions.getSettings 使用。 */
	getPermissionSettings(): PermissionSettingsSnapshot {
		return this.host.permissions.getSettings();
	}

	/** 设置 → 权限 保存：校验 + mtime 冲突检查 + tmp+rename 原子写（.bak 保留，enabled 保留文件原值）；
	 * 写后 createPermissionConfigLoader 在下一次 tool_call 前按 mtime+size 重读 = 保存即生效 */
	/** @deprecated 通过 BackendServices.permissions.saveSettings 使用。 */
	savePermissionSettings(input: PermissionSettingsSaveInput): PermissionSettingsSaveResult {
		try {
			const result = this.host.permissions.saveSettings(input);
			if (!result.ok)
				this.host.log.info("permissions.json 未保存", {
					reason: result.reason,
				});
			return result;
		} catch (err) {
			this.host.log.error("permissions.json 写入失败", err);
			throw err; // ipcMain.handle，reject 传回 renderer
		}
	}

	/** 设置 → 权限 恢复默认（用户可见字段写回默认，enabled 不动） */
	/** @deprecated 通过 BackendServices.permissions.resetSettings 使用。 */
	resetPermissionSettings(): PermissionSettingsSnapshot {
		return this.host.permissions.resetSettings();
	}

	/** 设置 → 权限 试算：同一套规则求值，只跑规则链（不模拟边界/临时区/项目内自动放行） */
	/** @deprecated 通过 BackendServices.permissions.probe 使用。 */
	probePermission(input: PermissionProbeInput): PermissionProbeResult {
		return this.host.permissions.probe(input);
	}

	/** 设置 → 权限 审计日志尾部（fullAccess 高危留痕，最新在前） */
	/** @deprecated 通过 BackendServices.permissions.getAuditTail 使用。 */
	getPermissionAuditTail(limit?: number): PermissionAuditTailEntry[] {
		return this.host.permissions.getAuditTail(limit);
	}

	/** 会话权限模式（default 缺省 fail-safe；关 tab 重开后端已归零，renderer 对齐用） */
	getSessionPermissionMode(sessionId: string): PermissionMode {
		return this.host.sessionPermissions.getMode(sessionId);
	}

	/** 切换会话权限模式（内存态即时生效，不落盘；会话不存在时抛可读错误） */
	setSessionPermissionMode(sessionId: string, mode: PermissionMode): void {
		this.host.sessionPermissions.setMode(sessionId, mode);
		this.host.log.info("permission mode", sessionId, { mode });
	}

	/** 上下文管理模式（二态：evaporation / off；单一 key 派生读，缺省蒸发） */
	getContextManagerConfig(): { mode: ContextManagerMode } {
		return { mode: readContextManagerMode(getAgentDir()) };
	}

	/** 写上下文管理模式（单一写者原子写，写后即效：下一轮 context 钩子见新值）。损坏拒写时上抛 */
	setContextManagerMode(mode: ContextManagerMode): void {
		try {
			writeContextManagerMode(getAgentDir(), mode);
		} catch (err) {
			this.host.log.error("settings.json 写入失败（contextManager mode 未保存）", err);
			throw err; // ipcMain.handle，reject 传回 renderer
		}
		this.host.log.info("context manager mode", mode);
	}

	/** channel-watch 总开关（设置 UI 用；键在 ~/.pi/agent/settings.json，缺省=开） */
	getChannelWatchConfig(): { enabled: boolean } {
		return { enabled: readChannelWatchEnabled(getAgentDir()) };
	}

	/** 写 channel-watch 开关（下一 session_start 生效：目录 init/watcher/工具注册全部跟随）。损坏拒写时上抛 */
	setChannelWatchEnabled(enabled: boolean): void {
		try {
			writeChannelWatchEnabled(getAgentDir(), enabled);
		} catch (err) {
			this.host.log.error("settings.json 写入失败（channel-watch 开关未保存）", err);
			throw err; // ipcMain.handle，reject 传回 renderer
		}
		this.host.log.info("channel watch enabled", enabled);
	}
}
