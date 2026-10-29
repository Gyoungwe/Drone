import { type Dirent, type FSWatcher, watch } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createLogger } from "../../log";

const log = createLogger("channel-watch-watcher");

/**
 * 频道子树 watcher（spec D4）：仅监听 `<cwd>/.local/agent-work/channel/` 子树。
 *
 * - 首选 `fs.watch(root, {recursive: true})`（macOS 原生支持，V4 冒烟实证 10 连写零丢）
 * - 原生事件触发快速快照对账；同时以 5s 轮询补齐漏事件，失败时保留快照并记录错误
 * - 事件解析：filename 第一段 = topic；以 `.` 开头的条目（.DS_Store / 编辑器临时文件）忽略
 * - 3s 防抖：同一文件多次变更合并为一次 onEvent（spec D5 层 3）
 * - hash 计算与投递判定不在此层（guard + extension 投递管道负责）
 */

export interface ChannelWatchEvent {
	/** 频道主题（channel/ 下第一段目录名） */
	topic: string;
	/** 频道子树内相对路径（含 topic 前缀，如 `channel-automation/IMPL-NOTES.md`） */
	relPath: string;
}

export type WatcherMode = "idle" | "watch" | "poll";

export interface ChannelWatcherOptions {
	channelRoot: string;
	onEvent: (event: ChannelWatchEvent) => void;
	/** 防抖窗口（默认 3000ms） */
	debounceMs?: number;
	/** 快照对账间隔（默认 5000ms）；原生监听模式也用它补齐漏事件。 */
	pollIntervalMs?: number;
}

/** filename → {topic, relPath}；不可用（空 / .开头 / 无 topic 段）返回 null */
export function parseWatchFilename(filename: string | Buffer | null): ChannelWatchEvent | null {
	if (!filename) return null;
	const rel = filename.toString();
	if (rel.length === 0) return null;
	const segments = rel.split(/[\\/]/).filter((s) => s.length > 0);
	if (segments.length === 0) return null;
	const topic = segments[0];
	if (!topic || topic.startsWith(".")) return null;
	// 文件名（最后一段）以 . 开头 → .DS_Store / .swp / .tmp 等噪音，忽略
	const last = segments[segments.length - 1] ?? topic;
	if (last.startsWith(".")) return null;
	return { topic, relPath: segments.join("/") };
}

export class ChannelWatcher {
	private readonly root: string;
	private readonly onEvent: (event: ChannelWatchEvent) => void;
	private readonly debounceMs: number;
	private readonly pollIntervalMs: number;
	private fsWatcher: FSWatcher | null = null;
	private pollTimer: NodeJS.Timeout | null = null;
	private pollSnapshot: Map<string, string> | null = null;
	private generation = 0;
	private readonly debounceTimers = new Map<string, NodeJS.Timeout>();
	private _mode: WatcherMode = "idle";

	constructor(options: ChannelWatcherOptions) {
		this.root = options.channelRoot;
		this.onEvent = options.onEvent;
		this.debounceMs = options.debounceMs ?? 3000;
		this.pollIntervalMs = options.pollIntervalMs ?? 5000;
	}

	get mode(): WatcherMode {
		return this._mode;
	}

	/** 启动原生监听与快照对账；原生失败时仅保留轮询，初始快照失败则关闭并抛错。 */
	async start(): Promise<WatcherMode> {
		if (this._mode !== "idle") return this._mode;
		const generation = ++this.generation;
		try {
			// channelRoot 可能尚不存在（init 失败/竞态）：watch 会 throw → 降级轮询里建快照
			this.fsWatcher = watch(this.root, { recursive: true }, () => this.reconcile());
		} catch (err) {
			log.warn("fs.watch 不可用，降级轮询", {
				root: this.root,
				error: err instanceof Error ? err.message : String(err),
			});
		}
		const watcher = this.fsWatcher;
		if (watcher) {
			watcher.on("error", (err) => {
				if (this.fsWatcher !== watcher) return;
				log.warn("fs.watch 错误，转降级轮询", { error: err instanceof Error ? err.message : String(err) });
				this.stopFswatch();
				this._mode = "poll";
			});
		}
		this._mode = this.fsWatcher ? "watch" : "poll";
		return this.startPolling(generation);
	}

	private stopFswatch(): void {
		if (this.fsWatcher) {
			this.fsWatcher.close();
			this.fsWatcher = null;
		}
	}

	private async startPolling(generation: number): Promise<WatcherMode> {
		if (this.pollTimer) return this._mode;
		let snapshot: Map<string, string>;
		try {
			snapshot = await this.scanSnapshot();
		} catch (error) {
			if (generation === this.generation) this.stop();
			throw error;
		}
		if (generation !== this.generation) return this._mode;
		this.pollSnapshot = snapshot;
		this.pollTimer = setInterval(() => this.reconcile(), this.pollIntervalMs);
		// unref：不阻止进程退出（会话关闭时即便 stop 漏调也不悬挂进程）
		this.pollTimer.unref?.();
		log.info("channel watcher 启动（快照对账）", {
			root: this.root,
			mode: this._mode,
			interval: this.pollIntervalMs,
		});
		return this._mode;
	}

	/** 扫描实际频道文件；目录级事件和漏事件不再被解释成不存在文件变化。 */
	private async scanSnapshot(): Promise<Map<string, string>> {
		const snapshot = new Map<string, string>();
		const scan = async (directory: string, prefix: string): Promise<void> => {
			let entries: Dirent[];
			try {
				entries = await readdir(directory, { withFileTypes: true });
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
				throw error;
			}
			for (const entry of entries) {
				if (entry.name.startsWith(".")) continue;
				const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
				if (entry.isDirectory()) await scan(join(directory, entry.name), relPath);
				else if (prefix && entry.isFile()) {
					try {
						const st = await lstat(join(this.root, relPath));
						if (st.isFile()) snapshot.set(relPath, `${st.mtimeMs}:${st.size}`);
					} catch (error) {
						if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
					}
				}
			}
		};
		await scan(this.root, "");
		return snapshot;
	}

	private reconcile(): void {
		void this.pollTick().catch((error: unknown) => {
			// Keep the last good snapshot; the next native hint or periodic scan can reconcile it.
			log.warn("channel watcher 快照扫描失败，保留上次快照", {
				error: error instanceof Error ? error.message : String(error),
			});
		});
	}

	private async pollTick(): Promise<void> {
		const prev = this.pollSnapshot;
		if (!prev) return;
		const next = await this.scanSnapshot();
		// A concurrent scan or stop/restart may have replaced this exact baseline while filesystem IO awaited.
		if (this.pollSnapshot !== prev) return;
		this.pollSnapshot = next;
		for (const [relPath, sig] of next) {
			if (prev.get(relPath) !== sig) {
				const parsed = parseWatchFilename(relPath);
				if (parsed) this.scheduleDebounced(parsed);
			}
		}
	}

	private scheduleDebounced(event: ChannelWatchEvent): void {
		const existing = this.debounceTimers.get(event.relPath);
		if (existing) clearTimeout(existing);
		const timer = setTimeout(() => {
			this.debounceTimers.delete(event.relPath);
			this.onEvent(event);
		}, this.debounceMs);
		timer.unref?.();
		this.debounceTimers.set(event.relPath, timer);
	}

	/** 停止并清理（幂等；session_shutdown 调用） */
	stop(): void {
		this.generation++;
		this.stopFswatch();
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
		this.pollSnapshot = null;
		for (const t of this.debounceTimers.values()) clearTimeout(t);
		this.debounceTimers.clear();
		this._mode = "idle";
	}
}
