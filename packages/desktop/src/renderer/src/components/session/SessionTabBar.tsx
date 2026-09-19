import type { DragEndEvent, Modifier } from "@dnd-kit/core";
import {
	closestCenter,
	DndContext,
	DragOverlay,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { restrictToHorizontalAxis, restrictToParentElement } from "@dnd-kit/modifiers";
import {
	horizontalListSortingStrategy,
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
} from "@dnd-kit/sortable";
import type { SessionMeta } from "@drone/shared";
import { taskNeedsUser } from "@drone/shared";
import type { ComponentProps } from "react";
import { useEffect, useRef, useState } from "react";
import { getPi } from "../../api";
import { useT } from "../../i18n";
import { isDailyCwd } from "../../lib/daily";
import { isDraftSessionId, useSessionsStore } from "../../stores/sessions";
import { pushToast } from "../../stores/toasts";
import { useTranscriptStore } from "../../stores/transcript";
import { useUiStore } from "../../stores/ui";
import { CloseIcon, CoffeeIcon, ListIcon, PanelRightIcon, PlusIcon, SubagentIcon } from "../icons";
import { sessionLetter, sessionTitle, useSessionStatus } from "./session-status";
import { UpdateButton } from "./UpdateButton";

/** 同名会话的区分后缀：createdAt 的 月/日 时:分（标题相同的两个会话至少能靠时间分辨） */
function timeSuffix(createdAt: number): string {
	const d = new Date(createdAt);
	const hh = String(d.getHours()).padStart(2, "0");
	const mm = String(d.getMinutes()).padStart(2, "0");
	return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

/** 标题去重：出现 ≥2 次的标题返回后缀映射（sessionId → 时间后缀） */
function useTitleSuffixes(sessions: SessionMeta[], untitled: string, daily: string): Map<string, string> {
	const counts = new Map<string, number>();
	for (const session of sessions) {
		const title = sessionTitle(session, untitled, daily);
		counts.set(title, (counts.get(title) ?? 0) + 1);
	}
	const out = new Map<string, string>();
	for (const session of sessions) {
		if ((counts.get(sessionTitle(session, untitled, daily)) ?? 0) > 1) {
			out.set(session.sessionId, timeSuffix(session.createdAt));
		}
	}
	return out;
}

/** 拖拽让位/落位的减速曲线（浏览器标签同款手感） */
const SORT_EASE = "cubic-bezier(0.2, 0, 0, 1)";

/** 拖拽轴锁定（挂在 DragOverlay 上）：只许水平移动，且钳在 tab 条容器内（浏览器标签行为）。
 *  必须挂 overlay：ghost 是 fixed 定位不参与滚动区域；若让指针 transform 落在流内胶囊上，
 *  Chromium 会把 transform 后的盒子计入滚动容器的可滚动区域 → 拖到右缘 scrollWidth 持续增长，
 *  auto-scroll 追着新边缘滚 = 无限右滚（左侧有 scrollLeft>=0 天然边界所以没事） */
const DRAG_MODIFIERS: Modifier[] = [restrictToHorizontalAxis, restrictToParentElement];

/** ghost 落位动画：fade 回到槽位（duration 用自己的曲线节奏） */
const DROP_ANIMATION = { duration: 180, easing: SORT_EASE };

const prefersReducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** 拖拽中的全局 cursor（指针常在胶囊外的间隙上，须挂在根元素） */
function setDraggingCursor(on: boolean): void {
	document.documentElement.classList.toggle("tab-dragging-cursor", on);
}

/** 胶囊视觉（presentational）：真实胶囊与拖拽 ghost 共用一份渲染。
 *  独立订阅自己的运行状态（切走后状态不丢）；苹果式设计：状态全收拢到头像图标
 *  （黑白色系，仅语义色保留琥珀/绿点），胶囊本体与标题完全不动 */
function TabPill({
	session,
	isActive,
	ghost = false,
	hidden = false,
	ghostWidth,
	buttonProps,
	suffix,
	onRename,
}: {
	session: SessionMeta;
	isActive: boolean;
	/** 同名会话的区分后缀（时间） */
	suffix?: string;
	/** DragOverlay ghost：拾起视觉，无交互 */
	ghost?: boolean;
	/** 真实胶囊正被 ghost 接管：隐藏本体但保留布局槽位（邻居让位计算依赖它） */
	hidden?: boolean;
	/** ghost 的固定宽度（px）= 拾起瞬间真实胶囊的实测宽：拖拽全程保持原尺寸，
	    不回弹到 max-w-52 最大形态（标签多被压窄时，变大会显得很跳） */
	ghostWidth?: number | null;
	buttonProps?: ComponentProps<"button">;
	/** 双击进入重命名（只读子会话 / draft 不提供） */
	onRename?: () => void;
}) {
	const t = useT();
	const closeSession = useSessionsStore((s) => s.closeSession);
	// 状态订阅与左侧会话轨道共用（优先级：审批 > 工作中 > 完成未读 > 空闲）
	const status = useSessionStatus(session.sessionId);
	// 头像字形 = 空间归属（日常 = 咖啡图标，项目 = 目录首字母）；只读子会话专属图标。
	// 余态底色：日常为画布底 + 细边框（白底黑字，与项目黑底白字反相）；状态色（审批琥珀/工作墨色）优先
	const daily = isDailyCwd(session.cwd);
	const letter = sessionLetter(session);
	const avatarClass = session.readOnly
		? "bg-accent text-on-accent"
		: status === "attention"
			? "bg-amber-500 text-on-ink"
			: status === "working"
				? "bg-ink text-on-ink tab-avatar-working"
				: daily
					? "border border-border-strong bg-canvas text-ink"
					: isActive
						? "bg-ink text-on-ink"
						: "bg-ink-faint text-on-ink";
	const title = sessionTitle(session, t("tabbar.untitled"), t("projects.daily"));
	return (
		<button
			type="button"
			{...buttonProps}
			style={{
				touchAction: "none",
				...(ghost ? { width: ghostWidth ?? 208 } : null),
				...(hidden ? { opacity: 0 } : null),
			}}
			className={`no-drag tab-pill group relative flex ${ghost ? "" : "w-full"} cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm ${
				isActive ? "bg-bubble text-ink" : "text-ink-dim hover:bg-hover hover:text-ink"
			} ${ghost ? "tab-dragging" : ""}`}
			onClick={ghost ? undefined : buttonProps?.onClick}
			onDoubleClick={ghost || !onRename ? undefined : onRename}
			title={ghost ? undefined : onRename ? `${title} · ${t("tabbar.renameHint")}` : title}
		>
			<span
				className={`relative flex h-4 w-4 shrink-0 items-center justify-center rounded text-[11px] font-semibold ${avatarClass}`}
			>
				{session.readOnly ? (
					<SubagentIcon size={11} />
				) : daily ? (
					<CoffeeIcon size={10} />
				) : (
					letter.toUpperCase()
				)}
				{!session.readOnly && status === "done" && (
					<span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-green-500 ring-1 ring-canvas" />
				)}
			</span>
			<span className="relative min-w-0 flex-1">
				<span className="block truncate text-left">
					{title}
					{suffix && <span className="tab-pill-suffix">{suffix}</span>}
				</span>
				{!ghost && (
					<>
						{/* hover 时尾部雾化渐变：盖住被叉叉重叠的文字尾，突出叉叉。
						   from 色必须与胶囊背景同款：active 背景是 bg-bubble，
						   直接 from-hover 在深色主题下会比 active 底色浅一档，渐变条会显成方形色块 */}
						<span
							aria-hidden="true"
							className={`pointer-events-none invisible absolute inset-y-0 right-0 w-7 bg-gradient-to-l to-transparent opacity-0 transition-opacity group-hover:visible group-hover:opacity-100 ${
								isActive ? "from-bubble" : "from-hover"
							}`}
						/>
						<span
							className="invisible absolute right-0 top-1/2 -translate-y-1/2 p-1 text-ink-dim opacity-0 transition-opacity hover:text-ink group-hover:visible group-hover:opacity-100"
							aria-hidden="true"
							title={t("tabbar.close")}
							onClick={(e) => {
								e.stopPropagation();
								void closeSession(session.sessionId);
							}}
						>
							<CloseIcon />
						</span>
					</>
				)}
			</span>
		</button>
	);
}

/** 胶囊内联重命名：Enter 提交 / Esc 取消 / 失焦提交；乐观更新本地标题，后端失败则回滚并 toast */
function TabRenameInput({ session, onDone }: { session: SessionMeta; onDone: () => void }) {
	const t = useT();
	const [value, setValue] = useState(
		session.name ?? sessionTitle(session, t("tabbar.untitled"), t("projects.daily")),
	);
	const inputRef = useRef<HTMLInputElement>(null);
	const settledRef = useRef(false);

	useEffect(() => {
		inputRef.current?.select();
	}, []);

	const finish = (commit: boolean) => {
		if (settledRef.current) return;
		settledRef.current = true;
		const next = value.trim();
		const previous = session.name;
		if (commit && next && next !== (previous ?? "")) {
			const store = useSessionsStore.getState();
			store.updateSessionName(session.sessionId, next);
			void getPi()
				.setSessionName(session.sessionId, next)
				.catch((error: unknown) => {
					useSessionsStore.getState().updateSessionName(session.sessionId, previous);
					pushToast("error", "tabbar.renameFailed", String((error as Error)?.message ?? error));
				});
		}
		onDone();
	};

	return (
		<input
			ref={inputRef}
			className="no-drag w-full rounded-lg bg-bubble px-2.5 py-1.5 text-sm text-ink outline-none ring-1 ring-accent"
			value={value}
			spellCheck={false}
			aria-label={t("tabbar.rename")}
			onChange={(e) => setValue(e.target.value)}
			onPointerDown={(e) => e.stopPropagation()}
			onKeyDown={(e) => {
				// 不让按键冒泡：dnd-kit 键盘传感器（Space 拾起）与全局 Esc 处理都不该响应输入中的按键
				e.stopPropagation();
				if (e.key === "Enter") {
					e.preventDefault();
					finish(true);
				} else if (e.key === "Escape") {
					e.preventDefault();
					finish(false);
				}
			}}
			onBlur={() => finish(true)}
		/>
	);
}

/** 单个会话 tab：几何层（useSortable 的 transform/transition）在 wrapper div 上按 dnd-kit 协议
 *  原样应用——transition 含 "none" 帧时绝不能覆盖成动画，那是 FLIP 布点帧（覆盖会造成落位回闪）；
 *  拖拽本体隐藏、由 DragOverlay 的 ghost 跟随指针（见 DRAG_MODIFIERS 注释） */
function SessionTab({
	session,
	isActive,
	suffix,
}: {
	session: SessionMeta;
	isActive: boolean;
	suffix?: string;
}) {
	const switchSession = useSessionsStore((s) => s.switchSession);
	const setView = useUiStore((s) => s.setView);
	const [renaming, setRenaming] = useState(false);
	// draft 还没有后端会话、只读子会话名字由父任务决定：两者都不开放重命名
	const canRename = !session.readOnly && !isDraftSessionId(session.sessionId);
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
		id: session.sessionId,
		disabled: renaming,
		// 自定义让位/落位节奏；reduced-motion 传 null = dnd-kit 不再给出过渡串
		transition: prefersReducedMotion() ? null : { duration: 220, easing: SORT_EASE },
	});
	// 动态宽度：flex-1 均分剩余空间（每胶囊 ≤ max-w-52），空间不足时平均压缩（≥ min-w-24），
	// 全到最短后溢出由外层 scroller 滚动兜底；ghost 拖拽层用拾起时的实测宽度（ghostWidth），不参与 flex 布局
	return (
		<div
			ref={setNodeRef}
			data-tab-id={session.sessionId}
			className="min-w-28 max-w-56 flex-1"
			style={{
				transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
				transition: transition || undefined,
			}}
		>
			{renaming ? (
				<TabRenameInput session={session} onDone={() => setRenaming(false)} />
			) : (
				<TabPill
					session={session}
					isActive={isActive}
					suffix={suffix}
					hidden={isDragging}
					onRename={canRename ? () => setRenaming(true) : undefined}
					buttonProps={{
						...attributes,
						...listeners,
						onClick: () => {
							switchSession(session.sessionId);
							setView("chat");
						},
					}}
				/>
			)}
		</div>
	);
}

/** 会话列表菜单项：状态点 + 标题（+ 同名后缀）+ 项目目录 */
function SessionListItem({
	session,
	isActive,
	suffix,
	onPick,
}: {
	session: SessionMeta;
	isActive: boolean;
	suffix?: string;
	onPick: () => void;
}) {
	const t = useT();
	const status = useSessionStatus(session.sessionId);
	const dot =
		status === "attention"
			? "bg-amber-500"
			: status === "working"
				? "bg-violet-500"
				: status === "done"
					? "bg-emerald-500"
					: "bg-ink-faint";
	return (
		<button
			type="button"
			role="menuitem"
			className={`session-list-item${isActive ? " on" : ""}`}
			onClick={onPick}
			title={session.cwd}
		>
			<span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
			<span className="min-w-0 flex-1 truncate">
				{sessionTitle(session, t("tabbar.untitled"), t("projects.daily"))}
				{suffix && <span className="tab-pill-suffix">{suffix}</span>}
			</span>
			<span className="shrink-0 text-[11px] text-ink-faint">{timeSuffix(session.createdAt)}</span>
		</button>
	);
}

/** 顶栏：macOS hiddenInset 红绿灯在左（预留 pl-20）；Windows 系统按钮覆盖层在右（预留 pr-[140px]）；
 *  Linux 原生框架两侧均不预留。会话 tab 从左排开，可拖拽排序（浏览器标签式） */
export function SessionTabBar() {
	const t = useT();
	const platform = getPi().platform;
	const sessions = useSessionsStore((s) => s.sessions);
	const activeSessionId = useSessionsStore((s) => s.activeSessionId);
	const createDraftSession = useSessionsStore((s) => s.createDraftSession);
	const reorderSessions = useSessionsStore((s) => s.reorderSessions);
	const cwd = useSessionsStore((s) => s.cwd);
	const view = useUiStore((s) => s.view);
	const setView = useUiStore((s) => s.setView);
	const panelOpen = useUiStore((s) => s.panelOpen);
	const togglePanel = useUiStore((s) => s.togglePanel);
	const agentActive = useTranscriptStore((s) =>
		activeSessionId ? (s.bySession[activeSessionId]?.agentActive ?? false) : false,
	);
	const suffixes = useTitleSuffixes(sessions, t("tabbar.untitled"), t("projects.daily"));
	const [listOpen, setListOpen] = useState(false);
	const listRef = useRef<HTMLDivElement>(null);
	// 提示点：最新一份 TaskView 里是否有任务在等用户拍板，或有权限请求挂起。
	// 只从 selector 返回布尔值——订阅 transcript 对象会随每条流式 delta 全量级联重渲染整条 tab bar。
	const taskAwaiting = useTranscriptStore((s) => {
		if (!activeSessionId) return false;
		const entry = s.bySession[activeSessionId];
		if (entry && entry.pendingPermissions.length > 0) return true;
		const messages = entry?.messages;
		if (!messages) return false;
		for (let i = messages.length - 1; i >= 0; i--) {
			const m = messages[i];
			if (m?.kind === "assistant" && m.taskView)
				// 终态卡不再进聊天流，所以「任务停在半路」只剩这个点能提示；
				// partial = 干到一半停了，不亮点的话用户完全不会知道。
				return m.taskView.tasks.some((t) => taskNeedsUser(t) || t.state === "partial");
		}
		return false;
	});
	const scrollerRef = useRef<HTMLDivElement>(null);
	const [activeId, setActiveId] = useState<string | null>(null);
	/** 被拖胶囊拾起时的实测宽度（px）：ghost 全程沿用，保持原胶囊尺寸。
	    不能读 active.rect.current.initial——dnd-kit 在 onDragStart 之后才填充该 ref，事件回调里恒为 null */
	const [dragWidth, setDragWidth] = useState<number | null>(null);
	const activeSession = sessions.find((s) => s.sessionId === activeId);
	// 拖拽期间：顶栏整体退出窗口拖拽区（胶囊间隙本是 drag-region，指针扫过会被 macOS 当拖窗口吞事件）
	const dragging = activeId !== null;
	// 5px 激活距离：原地点击/关胶囊不触发拖拽；键盘传感器支持 Space 抬起 + 左右键移动
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
	);
	const endDrag = () => {
		setActiveId(null);
		setDragWidth(null);
		setDraggingCursor(false);
	};

	// 正在查看的会话：完成未读标记立即清除（覆盖切 tab 与 projects ↔ chat 视图切换）
	useEffect(() => {
		if (activeSessionId && view === "chat") {
			useTranscriptStore.getState().markCompletionSeen(activeSessionId);
		}
	}, [activeSessionId, view]);

	// 会话列表菜单：点击外部 / Esc 关闭
	useEffect(() => {
		if (!listOpen) return;
		const onPointerDown = (e: PointerEvent) => {
			if (listRef.current && !listRef.current.contains(e.target as Node)) setListOpen(false);
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") setListOpen(false);
		};
		window.addEventListener("pointerdown", onPointerDown);
		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("pointerdown", onPointerDown);
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [listOpen]);

	// 鼠标滚轮（垂直）→ tab 横向滚动
	useEffect(() => {
		const el = scrollerRef.current;
		if (!el) return;
		const onWheel = (e: WheelEvent) => {
			const scrollable = el.scrollWidth > el.clientWidth;
			if (!scrollable) return;
			const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
			if (dx === 0) return;
			e.preventDefault();
			el.scrollLeft += dx;
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
	}, []);

	// macOS 左侧为红绿灯留 80px；Windows 右侧为窗口按钮覆盖层留 140px（3 × 46px 取整）
	const chromePadding =
		platform === "darwin" ? "pl-20 pr-3" : platform === "win32" ? "pl-3 pr-[140px]" : "pl-3 pr-3";

	return (
		<div
			className={`${dragging ? "" : "drag-region"} flex h-11 shrink-0 items-center gap-1 border-b border-border bg-canvas ${chromePadding}`}
		>
			<div
				ref={scrollerRef}
				className="flex min-w-0 flex-1 items-center gap-1 overflow-x-scroll [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
			>
				<DndContext
					sensors={sensors}
					collisionDetection={closestCenter}
					onDragStart={({ active }) => {
						setActiveId(String(active.id));
						setDragWidth(
							document
								.querySelector(`[data-tab-id="${CSS.escape(String(active.id))}"]`)
								?.getBoundingClientRect().width ?? null,
						);
						setDraggingCursor(true);
					}}
					onDragEnd={({ active, over }: DragEndEvent) => {
						endDrag();
						if (over && active.id !== over.id) {
							reorderSessions(String(active.id), String(over.id));
						}
					}}
					onDragCancel={endDrag}
				>
					<SortableContext items={sessions.map((s) => s.sessionId)} strategy={horizontalListSortingStrategy}>
						{sessions.map((session) => (
							<SessionTab
								key={session.sessionId}
								session={session}
								isActive={session.sessionId === activeSessionId}
								suffix={suffixes.get(session.sessionId)}
							/>
						))}
					</SortableContext>
					{/* 拖拽 ghost：fixed 定位（不参与滚动区域 → 不会撑大 scrollWidth），
					    落位时 fade 回槽位，真实胶囊同时 fade in（.tab-pill 的 opacity 过渡） */}
					<DragOverlay
						modifiers={DRAG_MODIFIERS}
						dropAnimation={prefersReducedMotion() ? null : DROP_ANIMATION}
					>
						{activeSession ? (
							<TabPill
								session={activeSession}
								isActive={activeSession.sessionId === activeSessionId}
								ghost
								ghostWidth={dragWidth}
							/>
						) : null}
					</DragOverlay>
				</DndContext>
			</div>
			{/* 全部会话菜单：胶囊被压窄/滚出视野时的兜底入口（状态点 + 标题 + 时间） */}
			{sessions.length > 0 && (
				<div ref={listRef} className="no-drag relative shrink-0">
					<button
						type="button"
						className={`no-drag shrink-0 rounded-lg p-1.5 transition-colors ${
							listOpen ? "bg-hover text-ink" : "text-ink-dim hover:bg-hover hover:text-ink"
						}`}
						onClick={() => setListOpen((v) => !v)}
						aria-label={t("tabbar.allSessions")}
						aria-expanded={listOpen}
						title={t("tabbar.allSessions")}
					>
						<ListIcon size={16} />
					</button>
					{listOpen && (
						<div className="session-list-pop" role="menu">
							{sessions.map((session) => (
								<SessionListItem
									key={session.sessionId}
									session={session}
									isActive={session.sessionId === activeSessionId}
									suffix={suffixes.get(session.sessionId)}
									onPick={() => {
										setListOpen(false);
										useSessionsStore.getState().switchSession(session.sessionId);
										setView("chat");
									}}
								/>
							))}
						</div>
					)}
				</div>
			)}
			<button
				type="button"
				className="no-drag shrink-0 rounded-lg p-1.5 text-ink-dim transition-colors hover:bg-hover hover:text-ink"
				onClick={() => {
					// 只建内存 draft tab（空 tab 重启自动消失）；发送首条消息时才真正创建后端会话
					createDraftSession();
					setView("chat");
				}}
				aria-label={cwd ? t("tabbar.newSession") : t("tabbar.pickProjectFirst")}
				title={cwd ? t("tabbar.newSession") : t("tabbar.pickProjectFirst")}
			>
				<PlusIcon size={18} />
			</button>
			<UpdateButton />
			{/* 右侧上下文面板开关（唯一右栏）：有任务等用户 / 权限挂起时琥珀点提示 */}
			{view === "chat" && (
				<button
					type="button"
					className={`no-drag relative shrink-0 rounded-lg p-1.5 transition-colors ${
						panelOpen ? "bg-hover text-ink" : "text-ink-dim hover:bg-hover hover:text-ink"
					}`}
					onClick={() => togglePanel(agentActive)}
					aria-label={t("tabbar.panel")}
					aria-expanded={panelOpen}
					aria-controls="context-panel"
					title={panelOpen ? t("panel.collapse") : t("panel.expand")}
				>
					<PanelRightIcon size={16} />
					{taskAwaiting && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-500" />}
				</button>
			)}
		</div>
	);
}
