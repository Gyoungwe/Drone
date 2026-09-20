import type {
	PermissionAuditTailEntry,
	PermissionSettingsIssue,
	PermissionSettingsSnapshot,
} from "@drone/shared";
import { create } from "zustand";
import { getPi } from "../api";
import {
	draftFromSettings,
	draftToSettings,
	type PermissionDraft,
	sameDraft,
	validateDraft,
} from "../components/settings/permissions-model";

/**
 * 设置 → 权限 面板状态：磁盘快照 + 编辑草稿 + 保存/冲突/校验结果。
 * 只编辑全局 permissions.json；会话权限模式（PermissionPicker，内存态）不经这里。
 */
export interface PermissionSettingsState {
	snapshot: PermissionSettingsSnapshot | null;
	draft: PermissionDraft | null;
	/** 与磁盘快照对比后的原始草稿（脏检查基线） */
	baseline: PermissionDraft | null;
	loading: boolean;
	saving: boolean;
	error: string | null;
	/** 保存被拒：后端校验问题（本地校验通过但后端仍拒时才会出现） */
	serverIssues: PermissionSettingsIssue[];
	/** 保存时发现文件已被外部修改：磁盘现状，供「重新加载 / 覆盖」选择 */
	conflict: PermissionSettingsSnapshot | null;
	/** 最近一次成功保存的时间戳（用于「已保存」提示） */
	savedAt: number | null;
	audit: PermissionAuditTailEntry[];
	auditLoaded: boolean;
	load: () => Promise<void>;
	update: (mutate: (draft: PermissionDraft) => PermissionDraft) => void;
	discard: () => void;
	save: (force?: boolean) => Promise<boolean>;
	reset: () => Promise<void>;
	loadAudit: () => Promise<void>;
	openLocation: () => Promise<void>;
}

function applySnapshot(snapshot: PermissionSettingsSnapshot) {
	const draft = draftFromSettings(snapshot.effective);
	return {
		snapshot,
		draft,
		baseline: draftFromSettings(snapshot.effective),
		conflict: null,
		serverIssues: [],
	};
}

export const usePermissionSettingsStore = create<PermissionSettingsState>((set, get) => ({
	snapshot: null,
	draft: null,
	baseline: null,
	loading: false,
	saving: false,
	error: null,
	serverIssues: [],
	conflict: null,
	savedAt: null,
	audit: [],
	auditLoaded: false,

	load: async () => {
		set({ loading: true, error: null });
		try {
			const snapshot = await getPi().getPermissionSettings();
			set({ ...applySnapshot(snapshot), loading: false });
		} catch (err) {
			set({ loading: false, error: err instanceof Error ? err.message : String(err) });
		}
	},

	update: (mutate) => {
		const { draft } = get();
		if (!draft) return;
		set({ draft: mutate(draft), serverIssues: [], savedAt: null });
	},

	discard: () => {
		const { snapshot } = get();
		if (snapshot) set({ ...applySnapshot(snapshot), savedAt: null });
	},

	save: async (force = false) => {
		const { draft, snapshot } = get();
		if (!draft || !snapshot) return false;
		if (validateDraft(draft).length > 0) return false;
		set({ saving: true, error: null, serverIssues: [], conflict: null });
		try {
			const result = await getPi().savePermissionSettings({
				settings: draftToSettings(draft, snapshot.effective.enabled),
				expectedMtimeMs: snapshot.mtimeMs,
				force,
			});
			if (result.ok) {
				set({ ...applySnapshot(result.snapshot), saving: false, savedAt: Date.now() });
				return true;
			}
			if (result.reason === "conflict") {
				set({ saving: false, conflict: result.snapshot });
				return false;
			}
			set({ saving: false, serverIssues: result.issues });
			return false;
		} catch (err) {
			set({ saving: false, error: err instanceof Error ? err.message : String(err) });
			return false;
		}
	},

	reset: async () => {
		set({ saving: true, error: null });
		try {
			const snapshot = await getPi().resetPermissionSettings();
			set({ ...applySnapshot(snapshot), saving: false, savedAt: Date.now() });
		} catch (err) {
			set({ saving: false, error: err instanceof Error ? err.message : String(err) });
		}
	},

	loadAudit: async () => {
		try {
			const audit = await getPi().getPermissionAuditTail(20);
			set({ audit, auditLoaded: true });
		} catch {
			set({ audit: [], auditLoaded: true });
		}
	},

	openLocation: async () => {
		try {
			await getPi().openPermissionSettingsLocation();
		} catch (err) {
			set({ error: err instanceof Error ? err.message : String(err) });
		}
	},
}));

/** 派生：草稿相对磁盘是否有改动 */
export function selectPermissionDirty(state: PermissionSettingsState): boolean {
	return Boolean(state.draft && state.baseline && !sameDraft(state.draft, state.baseline));
}
