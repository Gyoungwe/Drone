import type { SubagentPanelAgent } from "@drone/shared";
import { type RefObject, useEffect, useState } from "react";
import { getPi } from "../../api";
import { type AtToken, extractAtToken, filterFiles } from "./at-files";
import { type AtMenuItem, atMenuItems, filterSubagents, subagentsOfferable } from "./at-subagents";

export interface UseAtCompletionOptions {
	cwd: string | null;
	text: string;
	attachments: string[];
	slashOpen: boolean;
	/** slash 胶囊（与 @ 子智能体互斥：命令参数里的 @ 只是文件引用） */
	slashCommand: string | null;
	/** 已选中的 @ 子智能体胶囊（单任务：有胶囊后 @ 只补全文件） */
	subagent: string | null;
	/** 当前会话可派发子智能体（真实会话、非只读）；否则 @ 只补全文件 */
	dispatchable: boolean;
	/** 本会话可用子智能体（面板同一份快照；未加载时为空 → 菜单只有文件） */
	agents: readonly SubagentPanelAgent[];
	/** 消息开头出现 @ 时确保可用列表已加载（TTL 缓存，重复调用无副作用） */
	ensureAgents: () => void;
	setText: (updater: string | ((prev: string) => string)) => void;
	setAttachments: (updater: string[] | ((prev: string[]) => string[])) => void;
	/** 选中子智能体 → 胶囊（Composer 决定落草稿还是转面板） */
	onPickSubagent: (agent: SubagentPanelAgent) => void;
	textareaRef: RefObject<HTMLTextAreaElement | null>;
}

/**
 * @ 补全域：光标前 @ token 探测 + 项目文件列表拉取（每 cwd 一次）+ 消息开头的子智能体候选（S9）+
 * 选中/续钻 + 胶囊移除回填 + 键盘导航。子智能体与文件合并成一份扁平列表，↑↓ 跨组连续。
 */
export function useAtCompletion(options: UseAtCompletionOptions) {
	const { cwd, text, attachments, slashOpen, slashCommand, subagent, dispatchable, agents, ensureAgents } =
		options;
	const [atToken, setAtToken] = useState<AtToken | null>(null);
	const [atFiles, setAtFiles] = useState<string[]>([]);
	const [atFilesCwd, setAtFilesCwd] = useState<string | null>(null);
	const [atSelected, setAtSelected] = useState(0);
	const [atDismissed, setAtDismissed] = useState(false);

	/** @ 菜单：token 仍与当前文本一致才有效（程序化清空文本后自动失效），slash 打开时不竞争 */
	const atOpen =
		atToken !== null &&
		text.slice(atToken.start, atToken.end) === `@${atToken.query}` &&
		!atDismissed &&
		!slashOpen;
	/** 子智能体候选只在消息开头、无 slash 胶囊、未选过子智能体、会话可派发时出现 */
	const agentsOffered =
		atOpen &&
		atToken !== null &&
		subagentsOfferable({ tokenStart: atToken.start, slashCommand, subagent, dispatchable });
	const atItems: AtMenuItem[] =
		atOpen && atToken
			? atMenuItems({
					agents: agentsOffered ? filterSubagents(agents, atToken.query) : [],
					files: filterFiles(atFiles, atToken.query),
				})
			: [];

	// @ token 出现时拉取项目文件列表（每 cwd 一次，backend TTL 缓存；atToken 击键频变但条件拦截）
	useEffect(() => {
		if (!atToken || !cwd || atFilesCwd === cwd) return;
		let cancelled = false;
		void getPi()
			.listProjectFiles(cwd)
			.then((list) => {
				if (cancelled) return;
				setAtFiles(list);
				setAtFilesCwd(cwd);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [atToken, cwd, atFilesCwd]);

	// 消息开头出现 @ 且会话可派发：确保子智能体列表已加载（store 内 TTL 去重）
	useEffect(() => {
		if (agentsOffered) ensureAgents();
	}, [agentsOffered, ensureAgents]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: @ 查询词变化时重置选中项
	useEffect(() => {
		setAtSelected(0);
	}, [atToken?.query]);

	/** 文本变化后探测光标前 @ token（由 Composer 的 handleTextChange 调用） */
	const updateToken = (value: string, cursor: number) => {
		setAtToken(extractAtToken(value, cursor));
	};

	const focusAt = (cursor: number) => {
		requestAnimationFrame(() => {
			const el = options.textareaRef.current;
			if (el) {
				el.focus();
				el.setSelectionRange(cursor, cursor);
			}
		});
	};

	/** 选中文件/目录：文件 → @ 胶囊（token 从文本移除）；目录续钻（菜单保持，query 变为目录路径） */
	const handleFilePick = (path: string) => {
		if (!atToken) return;
		const isDir = path.endsWith("/");
		const before = text.slice(0, atToken.start);
		const after = text.slice(atToken.end);
		if (!isDir) {
			// token 两侧都是空白时收掉一个，避免出现双空格
			const joined = before.endsWith(" ") && after.startsWith(" ") ? before + after.slice(1) : before + after;
			options.setText(joined);
			options.setAttachments((prev) => [...prev, path]);
			setAtToken(null);
			focusAt(before.length);
			return;
		}
		const insert = `@${path}`;
		options.setText(before + insert + after);
		const cursor = (before + insert).length;
		setAtToken({ start: atToken.start, end: cursor, query: path });
		focusAt(cursor);
	};

	/** 选中子智能体：触发 token 原地移除（其余文字保留 = 任务正文），胶囊由 Composer 落草稿 */
	const handleAgentPick = (agent: SubagentPanelAgent) => {
		if (!atToken) return;
		if (!agent.trusted) return;
		const after = text.slice(atToken.end).replace(/^\s+/, "");
		options.setText(after);
		setAtToken(null);
		setAtDismissed(true);
		options.onPickSubagent(agent);
		focusAt(0);
	};

	const handleAtPick = (item: AtMenuItem) => {
		if (item.kind === "agent") handleAgentPick(item.agent);
		else handleFilePick(item.path);
	};

	/** 移除 @ 胶囊：恢复为全路径纯文本（追加到文本末尾，与 slash 胶囊删除恢复同逻辑） */
	const handleAttachmentRemove = (index: number) => {
		const path = attachments[index];
		if (!path) return;
		options.setAttachments((prev) => prev.filter((_, i) => i !== index));
		options.setText((prev) => (prev ? `${prev} @${path} ` : `@${path} `));
		requestAnimationFrame(() => {
			const el = options.textareaRef.current;
			if (el) {
				el.focus();
				const len = el.value.length;
				el.setSelectionRange(len, len);
			}
		});
	};

	/** @ 菜单键盘导航：↑↓ 移动，Enter/Tab 选中，Esc 折叠（保留文本）；消费事件返回 true */
	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
		if (!atOpen || !atToken) return false;
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setAtSelected((s) => Math.max(0, Math.min(s + 1, atItems.length - 1)));
			return true;
		}
		if (e.key === "ArrowUp") {
			e.preventDefault();
			setAtSelected((s) => Math.max(0, s - 1));
			return true;
		}
		if (e.key === "Escape") {
			e.preventDefault();
			setAtDismissed(true);
			return true;
		}
		if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing)) {
			e.preventDefault();
			const item = atItems[Math.max(0, Math.min(atSelected, atItems.length - 1))];
			if (item) handleAtPick(item);
			return true;
		}
		return false;
	};

	return {
		atToken,
		atOpen,
		atItems,
		agentsOffered,
		atSelected,
		setAtSelected,
		setAtDismissed,
		updateToken,
		handleAtPick,
		handleAttachmentRemove,
		handleKeyDown,
	};
}
