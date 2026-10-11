import type { ImageInput, SubagentPanelAgent } from "@drone/shared";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getPi } from "../../api";
import { useSessionReadOnly } from "../../hooks/use-session-state";
import { useT } from "../../i18n";
import { COMPOSER_FOCUS_EVENT, EMPTY_DRAFT, NEW_SESSION_DRAFT_KEY, useDraftStore } from "../../stores/drafts";
import { isDraftSessionId, useSessionsStore } from "../../stores/sessions";
import { useSettingsStore } from "../../stores/settings";
import { useSubagentsStore } from "../../stores/subagents";
import { pushToast } from "../../stores/toasts";
import { selectTranscript, useTranscriptStore } from "../../stores/transcript";
import { useUiStore } from "../../stores/ui";
import { ImagePreviewOverlay } from "../chat/ImagePreview";
import { SessionUsageFooter } from "../chat/UsageSettlement";
import { ArrowUpIcon, PlusIcon, StopIcon } from "../icons";
import { AtMenu } from "./AtMenu";
import { AttachmentChip } from "./AttachmentChip";
import { atAgentAvailability, restoreSubagentText } from "./at-subagents";
import { ContextRing } from "./ContextRing";
import { composerRunActive } from "./composer-run";
import { ImageTray } from "./ImageTray";
import { ModelPicker } from "./ModelPicker";
import { PermissionPicker } from "./PermissionPicker";
import { QueueBar } from "./QueueBar";
import { QuoteChip } from "./QuoteChip";
import { SendErrorBar } from "./SendErrorBar";
import { SlashMenu } from "./SlashMenu";
import { SlashPill } from "./SlashPill";
import { SubagentChip } from "./SubagentChip";
import { COMPOSER_LINE_PX, caretAtStart, chipIndentPx, chipsFitInline, chipsTotalWidth } from "./slash-pill";
import { ThinkingPicker } from "./ThinkingPicker";
import { useAtCompletion } from "./use-at-completion";
import { useComposerSend } from "./use-composer-send";
import { useSlashMenu } from "./use-slash-menu";

const EMPTY_AGENTS: readonly SubagentPanelAgent[] = [];

/**
 * 底部输入框：自动增高、Enter 发送、生成中显示停止（输入中仍可排队发送）；centered 用于空态居中布局。
 * 逻辑域拆在同目录 hooks（use-composer-send / use-slash-menu / use-at-completion），
 * 本组件只做装配与键盘事件的分发组合。
 * 消息开头的 @ 还能选子智能体（S9）：选中成胶囊，Enter 按胶囊直接派发（= 面板单任务派发）。
 */
export function Composer({ centered = false }: { centered?: boolean }) {
	const t = useT();
	const activeSessionId = useSessionsStore((s) => s.activeSessionId);
	/** 只读会话（subagent 产物检视）：输入/发送/图片全禁，模型与思考档位选择器置灰 */
	const readOnly = useSessionReadOnly();
	const cwd = useSessionsStore((s) => s.cwd);
	/** 信任决策应答后递增：draft 斜杠菜单按新决策（信任与否）重拉命令 */
	const trustVersion = useSessionsStore((s) => s.trustVersion);
	/** 图片门控数据源：会话覆写模型 ?? 全局默认 → models 表查 imageInput（ModelPicker 同款解析） */
	const models = useSessionsStore((s) => s.models);
	const noModel = models.length === 0;
	const openSettings = useSettingsStore((s) => s.openWith);
	const currentModel = useSessionsStore((s) => s.currentModel);
	const activeModel = useSessionsStore(
		(s) => s.sessions.find((x) => x.sessionId === s.activeSessionId)?.model,
	);
	const transcript = useTranscriptStore((s) => selectTranscript(s, activeSessionId));
	/** 当前模型是否支持图片输入；fail-open：模型未知/字段缺省一律按支持，只拦 imageInput === false */
	const effectiveModel = activeModel ?? currentModel;
	const activeModelInfo = effectiveModel
		? models.find((m) => m.provider === effectiveModel.provider && m.id === effectiveModel.modelId)
		: undefined;
	const imagesSupported = activeModelInfo?.imageInput !== false;
	/** 草稿（文本/图片/命令胶囊）按会话持久：切换会话/空态↔列表态换 Composer 实例不丢、不串会话 */
	const draftKey = activeSessionId ?? NEW_SESSION_DRAFT_KEY;
	const draft = useDraftStore((s) => s.bySession[draftKey] ?? EMPTY_DRAFT);
	const { text, images, slashCommand, subagent, attachments, quotes } = draft;
	const updateDraft = useDraftStore((s) => s.updateDraft);
	const setText = (updater: string | ((prev: string) => string)) => {
		updateDraft(draftKey, (d) => ({ ...d, text: typeof updater === "function" ? updater(d.text) : updater }));
	};
	const setImages = (updater: ImageInput[] | ((prev: ImageInput[]) => ImageInput[])) => {
		updateDraft(draftKey, (d) => ({
			...d,
			images: typeof updater === "function" ? updater(d.images) : updater,
		}));
	};
	const setSlashCommand = (command: string | null) => {
		updateDraft(draftKey, (d) => ({ ...d, slashCommand: command }));
	};
	const setSubagent = (agent: string | null) => {
		updateDraft(draftKey, (d) => ({ ...d, subagent: agent }));
	};
	const setAttachments = (updater: string[] | ((prev: string[]) => string[])) => {
		updateDraft(draftKey, (d) => ({
			...d,
			attachments: typeof updater === "function" ? updater(d.attachments) : updater,
		}));
	};
	const setQuotes = (updater: string[] | ((prev: string[]) => string[])) => {
		updateDraft(draftKey, (d) => ({
			...d,
			quotes: typeof updater === "function" ? updater(d.quotes) : updater,
		}));
	};
	const [previewImage, setPreviewImage] = useState<ImageInput | null>(null);
	const [dragActive, setDragActive] = useState(false);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const boxRef = useRef<HTMLElement>(null);
	/** 行首胶囊容器（slash / @ 子智能体 / @ 文件）：测宽决定内联缩进还是独占上方一行 */
	const chipsRef = useRef<HTMLDivElement>(null);
	const bodyRef = useRef<HTMLDivElement>(null);
	const [chipMetrics, setChipMetrics] = useState({ chips: 0, body: 0 });
	const fileInputRef = useRef<HTMLInputElement>(null);

	const followUpQueue = transcript.followUpQueue;
	/** 压缩进行中：禁发（SDK 拒绝压缩中的 prompt；提前拦截保住草稿，warn 提示代替报错丢文本） */
	const compacting = transcript.compacting;
	/** 输入框有内容：运行中停止钮仍保留，发送钮用于 follow-up 排队 */
	const hasContent =
		Boolean(text.trim()) ||
		images.length > 0 ||
		Boolean(slashCommand) ||
		Boolean(subagent) ||
		attachments.length > 0 ||
		quotes.length > 0;

	const send = useComposerSend({
		activeSessionId,
		text,
		images,
		attachments,
		quotes,
		slashCommand,
		subagent,
		followUpQueue,
		compacting,
		imagesSupported,
		setText,
		setImages,
		setAttachments,
		setQuotes,
		setSlashCommand,
		setSubagent,
	});
	const { sending, error, setError, feedback, showFeedback, ensureSession, runSlashCommand, handleSend } =
		send;
	const focusTextarea = () => textareaRef.current?.focus();
	const isStreaming = composerRunActive({
		sending,
		agentActive: transcript.agentActive,
		phase: transcript.phase,
	});
	const placeholder = readOnly
		? t("composer.placeholderReadOnly")
		: compacting
			? t("composer.placeholderCompacting")
			: isStreaming
				? t("composer.placeholderQueued")
				: t("composer.placeholder");

	/** @ 子智能体候选（S9）：只对真实、非只读会话提供，数据 = 面板同一份快照（store TTL 缓存） */
	const sessionKnown = useSessionsStore((s) => s.sessions.some((x) => x.sessionId === s.activeSessionId));
	const dispatchable = sessionKnown && !readOnly && !isDraftSessionId(activeSessionId);
	const agents = useSubagentsStore((s) =>
		activeSessionId ? (s.agentsBySession[activeSessionId]?.snapshot?.agents ?? EMPTY_AGENTS) : EMPTY_AGENTS,
	);
	const loadAgents = useSubagentsStore((s) => s.loadAgents);
	const ensureAgents = useCallback(() => {
		if (activeSessionId && dispatchable) void loadAgents(activeSessionId);
	}, [activeSessionId, dispatchable, loadAgents]);
	const subagentSource = subagent ? agents.find((agent) => agent.name === subagent)?.source : undefined;

	const slash = useSlashMenu({
		activeSessionId,
		cwd,
		trustVersion,
		text,
		slashCommand,
		subagent,
		setText,
		setSlashCommand,
		textareaRef,
		ensureSession,
		runSlashCommand,
		handleSend,
		showFeedback,
		setError,
	});

	const at = useAtCompletion({
		cwd,
		text,
		attachments,
		slashOpen: slash.slashOpen,
		slashCommand,
		subagent,
		dispatchable,
		agents,
		ensureAgents,
		setText,
		setAttachments,
		/** 内置 / 用户级 → 胶囊；项目级定义每次派发都要在面板勾选信任 → 转面板表单预填（会话内不记忆） */
		onPickSubagent: (agent) => {
			if (atAgentAvailability(agent) === "needs_panel") {
				useSubagentsStore.getState().setDraftAgent(agent.name);
				useUiStore.getState().openPanel("subagents");
				showFeedback(t("composer.subagentNeedsPanel", { agent: agent.name }));
				return;
			}
			setSubagent(agent.name);
		},
		textareaRef,
	});

	/** 胶囊整枚撤销（Esc / 空文本 Backspace / ×）：`@name ` 拼回文本开头等待继续编辑；菜单不立刻重弹 */
	const { setAtDismissed } = at;
	const restoreSubagentChip = (e?: React.KeyboardEvent<HTMLTextAreaElement>) => {
		e?.preventDefault();
		const agent = subagent;
		if (!agent) return;
		setSubagent(null);
		// 光标落在拼回的 `@name ` 之后（原任务正文之前）：与行内 token 后退格的直觉一致；空文本时即末尾
		const caret = restoreSubagentText(agent, text).length - text.length;
		setText((prev) => restoreSubagentText(agent, prev));
		setAtDismissed(true);
		requestAnimationFrame(() => {
			const el = textareaRef.current;
			if (el) {
				el.focus();
				const pos = Math.min(Math.max(caret, 0) || el.value.length, el.value.length);
				el.setSelectionRange(pos, pos);
			}
		});
	};

	const hasChips = Boolean(slashCommand) || Boolean(subagent) || attachments.length > 0;
	/** 胶囊测宽：各胶囊自身宽度之和（与内联/换行布局无关，两态切换不会互相抖动）+ 正文区宽度 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: 胶囊集合变化时重挂 ResizeObserver
	useLayoutEffect(() => {
		const chipsEl = chipsRef.current;
		const bodyEl = bodyRef.current;
		if (!chipsEl || !bodyEl) {
			setChipMetrics((m) => (m.chips === 0 && m.body === 0 ? m : { chips: 0, body: 0 }));
			return;
		}
		const measure = () => {
			const chips = chipsTotalWidth(
				Array.from(chipsEl.children).map((child) => child.getBoundingClientRect().width),
			);
			const body = bodyEl.clientWidth;
			setChipMetrics((m) => (m.chips === chips && m.body === body ? m : { chips, body }));
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(bodyEl);
		for (const child of Array.from(chipsEl.children)) observer.observe(child);
		return () => observer.disconnect();
	}, [hasChips, slashCommand, subagent, attachments]);
	const chipsInline = hasChips && chipsFitInline(chipMetrics.chips, chipMetrics.body);
	const textIndent = chipsInline ? chipIndentPx(chipMetrics.chips) : 0;

	// biome-ignore lint/correctness/useExhaustiveDependencies: 高度由文本 DOM 变化驱动，显式依赖 text 便于触发；缩进变化影响折行
	useEffect(() => {
		const el = textareaRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
	}, [text, textIndent]);

	// 撤回回填草稿后聚焦输入框继续编辑（sessions store 派发，window 事件解耦组件间依赖）
	useEffect(() => {
		const onFocusRequest = () => textareaRef.current?.focus();
		window.addEventListener(COMPOSER_FOCUS_EVENT, onFocusRequest);
		return () => window.removeEventListener(COMPOSER_FOCUS_EVENT, onFocusRequest);
	}, []);

	// 点击输入框容器外部时收起命令/文件面板（文本保留；继续输入时恢复）
	const { setSlashDismissed } = slash;
	useEffect(() => {
		if (!slash.slashOpen && !at.atOpen) return;
		const onPointerDown = (e: PointerEvent) => {
			if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
				setSlashDismissed(true);
				setAtDismissed(true);
			}
		};
		window.addEventListener("pointerdown", onPointerDown);
		return () => window.removeEventListener("pointerdown", onPointerDown);
	}, [slash.slashOpen, at.atOpen, setSlashDismissed, setAtDismissed]);

	/** 文本变化：重置菜单折叠态 + 探测光标前 @ / slash token（驱动两个菜单） */
	const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
		slash.setSlashDismissed(false);
		at.setAtDismissed(false);
		setText(e.target.value);
		const cursor = e.target.selectionStart ?? e.target.value.length;
		slash.updateToken(e.target.value, cursor);
		at.updateToken(e.target.value, cursor);
	};

	/** 光标移动（点击/方向键）：重探 slash token（@ 菜单仅输入驱动，点进去不弹） */
	const handleSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
		const el = e.currentTarget;
		slash.updateToken(el.value, el.selectionStart ?? el.value.length);
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (at.handleKeyDown(e)) return;
		if (slash.handleKeyDown(e)) return;
		// 胶囊撤销：Esc（任意文本态，菜单未消费时）；空文本 Backspace/Delete 先 @ 文件胶囊，再子智能体 / slash 胶囊
		if (slashCommand && e.key === "Escape") {
			slash.restoreSlashPill(e);
			return;
		}
		if (subagent && e.key === "Escape") {
			restoreSubagentChip(e);
			return;
		}
		if (e.key === "Escape" && isStreaming) {
			e.preventDefault();
			void send.handleStop();
			return;
		}
		// 胶囊是正文前的行内 token：空文本 Backspace/Delete，或光标停在正文最前时 Backspace，都整枚撤销
		const emptyErase = text === "" && (e.key === "Backspace" || e.key === "Delete");
		const eraseBeforeText =
			e.key === "Backspace" &&
			hasChips &&
			caretAtStart(e.currentTarget.selectionStart, e.currentTarget.selectionEnd);
		if (emptyErase || eraseBeforeText) {
			// 胶囊撤销：视觉由近及远（@ 文件 → @ 子智能体 / slash 命令 → 引用）
			if (attachments.length > 0) {
				e.preventDefault();
				at.handleAttachmentRemove(attachments.length - 1);
				return;
			}
			if (subagent) {
				restoreSubagentChip(e);
				return;
			}
			if (slashCommand) {
				slash.restoreSlashPill(e);
				return;
			}
			// 引用胶囊在上方独立一行，不与正文相邻：只在空文本时退格撤销
			if (emptyErase && quotes.length > 0) {
				e.preventDefault();
				setQuotes((prev) => prev.slice(0, -1));
				return;
			}
		}
		if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
			e.preventDefault();
			void handleSend();
		}
	};

	const handleFiles = (files: FileList | File[] | null) => {
		if (!files || files.length === 0) return;
		// 图片门控入口防御：+ 按钮/粘贴之外的路径不再存在，仍早退兜底
		if (!imagesSupported) return;
		for (const file of Array.from(files)) {
			if (!file.type.startsWith("image/")) continue;
			const reader = new FileReader();
			reader.onload = () => {
				const result = reader.result;
				if (typeof result !== "string") return;
				const comma = result.indexOf(",");
				if (comma === -1) return;
				setImages((prev) => [...prev, { data: result.slice(comma + 1), mimeType: file.type }]);
			};
			reader.readAsDataURL(file);
		}
	};

	/** 截图/复制图片后 Ctrl+V 粘贴到输入框 */
	const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
		const items = e.clipboardData?.items;
		if (!items) return;
		const files: File[] = [];
		for (const item of items) {
			if (item.type.startsWith("image/")) {
				const file = item.getAsFile();
				if (file) files.push(file);
			}
		}
		if (files.length === 0) return;
		// 图片门控：纯文本模型拦截粘贴（默认行为可能把图片数据塞进文本框，必须 preventDefault）
		if (!imagesSupported) {
			e.preventDefault();
			// 顶栏右侧 toast 卡（不用内联反馈：该提示不阻塞继续输入，卡片可手动关）
			pushToast("warning", "composer.imageUnsupported");
			return;
		}
		e.preventDefault();
		handleFiles(files);
	};

	/** Resolve a dropped path to the existing @-file reference shape. */
	const projectRelativePath = (sourcePath: string): string | null => {
		if (!cwd) return null;
		const normalize = (value: string) => value.replaceAll("\\", "/").replace(/\/+$/, "");
		const root = normalize(cwd);
		const candidate = normalize(sourcePath);
		const prefix = `${root}/`;
		if (candidate === root || !candidate.toLowerCase().startsWith(prefix.toLowerCase())) return null;
		return candidate.slice(prefix.length);
	};

	/** Native files are copied by main for paths outside the current project. */
	const handleDrop = async (event: React.DragEvent<HTMLElement>) => {
		setDragActive(false);
		event.preventDefault();
		if (readOnly) return;
		const files = Array.from(event.dataTransfer.files || []);
		const uriPaths = event.dataTransfer
			.getData("text/uri-list")
			.split(/\r?\n/)
			.map((uri) => uri.trim())
			.filter((uri) => uri && !uri.startsWith("#"))
			.flatMap((uri) => {
				try {
					const parsed = new URL(uri);
					if (parsed.protocol !== "file:") return [];
					const path = decodeURIComponent(parsed.pathname);
					return [/^\/[a-zA-Z]:\//.test(path) ? path.slice(1) : path];
				} catch {
					return [];
				}
			});
		if (files.length === 0 && uriPaths.length === 0) return;
		const imported: string[] = [];
		for (const [index, file] of files.entries()) {
			if (file.type.startsWith("image/")) {
				handleFiles([file]);
				continue;
			}
			const sourcePath = (file as File & { path?: string }).path || uriPaths[index];
			if (!sourcePath) continue;
			const relative = projectRelativePath(sourcePath);
			if (relative) {
				imported.push(relative);
				continue;
			}
			try {
				const copy = await getPi().importDroppedFile(sourcePath, activeSessionId ?? "new-session");
				imported.push(copy.path);
			} catch (error) {
				showFeedback(error instanceof Error ? error.message : String(error), "warn");
			}
		}
		// Some desktop shells expose only text/uri-list for a file drag. Reuse the
		// same project-reference/copy path for any URI without a File entry.
		for (const sourcePath of uriPaths.slice(files.length)) {
			const relative = projectRelativePath(sourcePath);
			if (relative) {
				imported.push(relative);
				continue;
			}
			try {
				const copy = await getPi().importDroppedFile(sourcePath, activeSessionId ?? "new-session");
				imported.push(copy.path);
			} catch (error) {
				showFeedback(error instanceof Error ? error.message : String(error), "warn");
			}
		}
		if (imported.length) setAttachments((prev) => [...new Set([...prev, ...imported])]);
	};

	return (
		<section
			ref={boxRef}
			className={`drone-composer ${centered ? "w-full max-w-[760px]" : "shrink-0 px-4 pb-2"} relative`}
			aria-label={t("composer.dropRegion")}
			onDragOver={(event) => {
				event.preventDefault();
				if (!readOnly) setDragActive(true);
			}}
			onDragLeave={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false);
			}}
			onDrop={(event) => void handleDrop(event)}
		>
			<div className="mx-auto max-w-[760px]">
				{dragActive && (
					<div
						className="pointer-events-none absolute inset-x-0 top-0 z-10 rounded-2xl border-2 border-dashed border-accent bg-accent/10 px-3 py-2 text-center text-xs text-accent"
						data-testid="composer-drop-target"
					>
						{t("composer.dropTarget")}
					</div>
				)}
				{error && <SendErrorBar error={error} onRetry={() => void handleSend()} />}
				{feedback && !error && (
					<p className={`mb-1.5 text-xs ${feedback.tone === "warn" ? "text-amber-500" : "text-ink-dim"}`}>
						{feedback.message}
					</p>
				)}
				{followUpQueue.length > 0 && (
					<QueueBar
						text={followUpQueue[0] ?? ""}
						onRestore={() => void send.handleRestoreQueue(focusTextarea)}
					/>
				)}
				<SessionUsageFooter sessionId={activeSessionId} />
				<ImageTray
					images={images}
					onPreview={setPreviewImage}
					onRemove={(index) => setImages((prev) => prev.filter((_, i) => i !== index))}
				/>
				{noModel && !readOnly && (
					<button
						type="button"
						className="mb-2 w-full rounded-xl border border-border bg-hover px-3 py-2 text-left text-[12px] text-ink-2"
						onClick={() => openSettings("models")}
					>
						{t("composer.noModelHint")}
					</button>
				)}
				<div className="relative rounded-2xl border-[0.5px] border-border bg-surface shadow-soft">
					{/* 斜杠 / @ 补全面板：锚定输入框上沿的浮层（absolute bottom-full），不占文档流——
					    原先在流内渲染，空态居中布局（justify-center）里一开菜单整个输入框就被推下半个菜单高；
					    浮层宽度与输入框一致、贴着输入框弹出，Composer 外层 relative z-20 保证盖住消息区 */}
					{(slash.slashOpen || at.atOpen) && (
						<div
							className="absolute inset-x-0 bottom-full z-(--z-dropdown)"
							data-testid="composer-menu-anchor"
						>
							{slash.slashOpen && (
								<SlashMenu
									commands={slash.slashCommands}
									showSpecialized={slash.showSpecialized}
									workflowDirection={slash.workflowDirection}
									onBackToWorkflows={slash.backToWorkflows}
									onToggleSpecialized={slash.toggleSpecialized}
									query={slash.slashQuery}
									selectedIndex={slash.slashSelected}
									onSelectedIndexChange={slash.setSlashSelected}
									onPick={(command) => void slash.handleSlashPick(command)}
								/>
							)}
							{at.atOpen && (
								<AtMenu
									items={at.atItems}
									agentsOffered={at.agentsOffered}
									selectedIndex={at.atSelected}
									onSelectedIndexChange={at.setAtSelected}
									onPick={at.handleAtPick}
								/>
							)}
						</div>
					)}
					{/* 引用胶囊区：独占顶部一行贴边（专为选中引用留的位置，不占正文宽度） */}
					{quotes.length > 0 && (
						<div className="flex flex-wrap items-center gap-1.5 px-3 pt-2">
							{quotes.map((quote) => (
								<QuoteChip
									key={quote}
									quote={quote}
									onRemove={() => setQuotes((prev) => prev.filter((q) => q !== quote))}
								/>
							))}
						</div>
					)}
					{/* 正文行：slash / @ 子智能体 / @ 文件胶囊是正文前的行内 token——
					    胶囊绝对定位在首行行首，textarea 用 text-indent 让出胶囊宽度：首行文字紧接胶囊、后续行回到左边缘，
					    胶囊高度 = 行高（COMPOSER_LINE_PX）、顶对齐 → 与文字同一中线（原 flex-wrap + mt-0.5 + 24px 胶囊
					    对 22.75px 行高错位约 2.6px，且折行文字挂在胶囊右侧形成悬挂缩进）。
					    胶囊过宽（> 60% 宽度）时退为输入框上方独立一行。textarea 恒在同一位置 → 不重挂、不丢焦点 */}
					<div className={`px-3 pb-4 ${quotes.length > 0 ? "pt-1.5" : "pt-2"}`}>
						<div ref={bodyRef} className="relative">
							{hasChips && (
								<div
									ref={chipsRef}
									data-testid="composer-chips"
									data-layout={chipsInline ? "inline" : "row"}
									className={
										chipsInline
											? "absolute top-0 left-0 z-[1] flex items-center gap-1.5"
											: "mb-1 flex flex-wrap items-center gap-1.5"
									}
									style={chipsInline ? { height: COMPOSER_LINE_PX } : undefined}
								>
									{slashCommand && (
										<SlashPill name={slashCommand} onRemove={() => slash.restoreSlashPill()} />
									)}
									{subagent && (
										<SubagentChip
											name={subagent}
											source={subagentSource}
											onRemove={() => restoreSubagentChip()}
										/>
									)}
									{attachments.map((path, index) => (
										<AttachmentChip
											key={path}
											path={path}
											onRemove={() => at.handleAttachmentRemove(index)}
										/>
									))}
								</div>
							)}
							<textarea
								ref={textareaRef}
								data-testid="composer-input"
								className="block max-h-[200px] w-full resize-none bg-transparent text-[14px] outline-none placeholder:text-ink-faint select-text"
								style={{ lineHeight: `${COMPOSER_LINE_PX}px`, textIndent }}
								placeholder={
									subagent
										? t("composer.subagentTaskPlaceholder", { agent: subagent })
										: slashCommand
											? slashCommand.startsWith("skill:")
												? t("slash.skillArgPlaceholder")
												: t("slash.argPlaceholder")
											: placeholder
								}
								value={text}
								rows={1}
								disabled={readOnly || sending}
								onChange={handleTextChange}
								onKeyDown={handleKeyDown}
								onSelect={handleSelect}
								onPaste={handlePaste}
							/>
						</div>
					</div>
					<div className="flex items-center gap-1.5 px-2.5 pb-1.5">
						<input
							ref={fileInputRef}
							type="file"
							accept="image/*"
							multiple
							className="hidden"
							onChange={(e) => {
								handleFiles(e.target.files);
								e.target.value = "";
							}}
						/>
						<button
							type="button"
							className="-ml-1 flex h-7 w-7 items-center justify-center rounded-lg text-ink-dim transition-colors hover:bg-hover hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
							aria-label={t("composer.addImage")}
							title={!imagesSupported ? t("composer.imageUnsupported") : undefined}
							disabled={readOnly || !imagesSupported}
							onClick={() => fileInputRef.current?.click()}
						>
							<PlusIcon size={18} />
						</button>
						{/* 中缝：@ 子智能体胶囊在场时提示 Enter = 派发（与 S9 输入框底栏一致） */}
						<div className="min-w-0 flex-1 truncate text-[11px] text-ink-faint" data-testid="composer-hint">
							{subagent ? t("composer.dispatchHint") : null}
						</div>
						{/* 右侧控件组（一处一事）：[模型 · 强度] [权限] [上下文环] [发送] */}
						<div
							className={`composer-model-group${readOnly ? " pointer-events-none opacity-40" : ""}`}
							title={t("composer.modelGroupHint")}
						>
							<ModelPicker />
							<span className="composer-model-sep" aria-hidden="true" />
							<ThinkingPicker />
						</div>
						<div className={readOnly ? "pointer-events-none opacity-40" : undefined}>
							<PermissionPicker />
						</div>
						<ContextRing />
						{isStreaming ? (
							<button
								type="button"
								className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-on-ink transition-colors hover:bg-red-600"
								onClick={() => void send.handleStop()}
								aria-label={t("composer.stop")}
								title={t("composer.stop")}
							>
								<StopIcon />
							</button>
						) : null}
						{!isStreaming || hasContent ? (
							<button
								type="button"
								className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-on-ink transition-colors hover:bg-ink-2 disabled:opacity-30"
								disabled={readOnly || !hasContent || sending || noModel}
								onClick={() => {
									if (noModel) {
										openSettings("models");
										return;
									}
									void handleSend();
								}}
								aria-label={subagent ? t("composer.dispatch") : t("composer.send")}
								title={subagent ? t("composer.dispatch") : t("composer.send")}
								data-testid="composer-send"
							>
								<ArrowUpIcon size={20} />
							</button>
						) : null}
					</div>
				</div>
			</div>
			{previewImage && <ImagePreviewOverlay image={previewImage} onClose={() => setPreviewImage(null)} />}
		</section>
	);
}
