import type {
	PermissionAnswer,
	PermissionRequest,
	PermissionRequestKind,
	PermissionResolved,
} from "@drone/shared";

export type PermissionResponder = (req: PermissionRequest) => void;

/** 权限请求附加元数据（内置权限门控扩展专用；其余扩展 confirm 不带） */
export interface PermissionRequestMeta {
	kind: PermissionRequestKind;
	/** path 类越界时建议加入工作区的根目录（git 根候选） */
	suggestDir?: string;
}

let nextId = 0;

/**
 * 权限确认门控：将 pi 扩展的 uiContext.confirm 桥接为 permission_request 事件。
 * 会话内「总是允许」（同 title 自动通过）+ 项目级持久化（由 PiBackend 落 workspaces.json）。
 */
export class PermissionGate {
	private readonly pending = new Map<
		string,
		{ resolve: (answer: boolean) => void; cleanup: () => void; message: string; meta?: PermissionRequestMeta }
	>();
	private readonly titles = new Map<string, string>();
	private readonly alwaysAllowed = new Set<string>();
	/** 本次 run 全放行（allowRun）：endRun（agent_end）归零 */
	private runAllowed = false;

	private sessionId = "";

	constructor(
		private readonly onRequest: PermissionResponder,
		private readonly onCanceled?: (result: PermissionResolved) => void,
	) {}

	/** 会话创建后才能确定 sessionId，创建后绑定 */
	bindSession(sessionId: string): void {
		this.sessionId = sessionId;
	}

	/** 实现 ExtensionUIContext.confirm 的语义；meta 由内置权限扩展携带（kind/suggestDir） */
	confirm(
		title: string,
		message: string,
		meta?: PermissionRequestMeta,
		signal?: AbortSignal,
	): Promise<boolean> {
		if (signal?.aborted) return Promise.resolve(false);
		if (this.runAllowed || this.alwaysAllowed.has(title)) {
			return Promise.resolve(true);
		}
		const id = `perm-${this.sessionId}-${nextId++}`;
		return new Promise<boolean>((resolve) => {
			const cancel = () => {
				if (!this.pending.has(id)) return;
				this.pending.delete(id);
				this.titles.delete(id);
				cleanup();
				resolve(false);
				this.onCanceled?.({ sessionId: this.sessionId, requestId: id, answered: false });
			};
			const cleanup = () => signal?.removeEventListener("abort", cancel);
			this.pending.set(id, { resolve, cleanup, message, meta });
			signal?.addEventListener("abort", cancel, { once: true });
			this.titles.set(id, title);
			this.onRequest({
				id,
				sessionId: this.sessionId,
				title,
				message,
				kind: meta?.kind ?? "other",
				suggestDir: meta?.suggestDir,
			});
		});
	}

	/** 未决请求信息（PiBackend 处理 allowDir/allowAlways 持久化用） */
	getRequest(requestId: string): { title: string; meta?: PermissionRequestMeta } | undefined {
		if (!this.pending.has(requestId)) return undefined;
		return { title: this.titles.get(requestId) ?? "", meta: this.pending.get(requestId)?.meta };
	}

	/** 全部未决请求的只读快照。 */
	listPending(): PermissionRequest[] {
		return [...this.pending.entries()].map(([id, entry]) => ({
			id,
			sessionId: this.sessionId,
			title: this.titles.get(id) ?? "",
			message: entry.message,
			kind: entry.meta?.kind ?? "other",
			suggestDir: entry.meta?.suggestDir,
		}));
	}

	/** 请求所属会话（持久化定位项目根用） */
	getSessionId(): string {
		return this.sessionId;
	}

	respond(requestId: string, answer: PermissionAnswer): void {
		const entry = this.pending.get(requestId);
		if (!entry) return;
		const title = this.titles.get(requestId) ?? "";
		this.pending.delete(requestId);
		this.titles.delete(requestId);
		if (answer === "allowAlways" && title) {
			this.alwaysAllowed.add(title);
		}
		entry.cleanup();
		entry.resolve(answer !== "deny");
		if (answer === "allowRun") {
			// 本次 run 内后续确认直接通过；已排队的请求一并放行（用户语义：这一趟别再问了）
			this.runAllowed = true;
			for (const [id, queued] of this.pending) {
				this.pending.delete(id);
				this.titles.delete(id);
				queued.cleanup();
				queued.resolve(true);
			}
		}
	}

	/** 本次 run 是否处于全放行态 */
	isRunAllowed(): boolean {
		return this.runAllowed;
	}

	/** run 结束（agent_end）：allowRun 失效，下一条用户消息重新按规则审批 */
	endRun(): void {
		this.runAllowed = false;
	}

	dispose(): void {
		this.runAllowed = false;
		for (const { resolve, cleanup } of this.pending.values()) {
			cleanup();
			resolve(false);
		}
		this.pending.clear();
		this.titles.clear();
	}
}
