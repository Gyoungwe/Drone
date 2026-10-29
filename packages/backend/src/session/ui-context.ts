import { stripVTControlCharacters } from "node:util";
import type { PermissionGate } from "../permissions/gate";
import type { ExtensionUIContext } from "../session-engine/sdk";
import { Theme } from "../session-engine/sdk";
import type { AskGate } from "./ask-gate";

/**
 * 提供给扩展的契约 Theme 实例（中性暗色盘，truecolor）。
 *
 * pi 扩展契约要求 ctx.ui.theme 是带 fg()/bg()/bold() 等方法的 Theme 对象（extensions.md
 * 标准用法）；桌面状态栏消费清理过 ANSI 的文本，但对象本身必须真
 * （issue #28：pi-mcp-adapter 在 updateStatusBar 里 ui.theme.fg("accent", ...) 空对象/字符串
 * 直接抛 TypeError，全部 MCP 服务器连接失败）。用真实 Theme 类实例保证全部 12+ 方法存在，
 * 而非手写 pass-through 对象（进了一支扩展调用 italic()/getFgAnsi() 还是会崩）。
 *
 * 色盘为静态中性色：桌面端不消费 ANSI 输出，无需跟随 GUI 亮暗主题；构造参数受 TS 约束，
 * SDK 升级新增必填色时 typecheck 会报错提醒补齐。Theme 构造纯内存计算，无环境依赖。
 */
const EXTENSION_THEME = new Theme(
	{
		accent: "#7aa2f7",
		border: "#3b4261",
		borderAccent: "#7aa2f7",
		borderMuted: "#292e42",
		success: "#9ece6a",
		error: "#f7768e",
		warning: "#e0af68",
		muted: "#78849b",
		dim: "#565f89",
		text: "#c0caf5",
		thinkingText: "#9d7cd8",
		userMessageText: "#c0caf5",
		customMessageText: "#c0caf5",
		customMessageLabel: "#7aa2f7",
		toolTitle: "#7dcfff",
		toolOutput: "#a9b1d6",
		mdHeading: "#7aa2f7",
		mdLink: "#7dcfff",
		mdLinkUrl: "#565f89",
		mdCode: "#9ece6a",
		mdCodeBlock: "#a9b1d6",
		mdCodeBlockBorder: "#3b4261",
		mdQuote: "#a9b1d6",
		mdQuoteBorder: "#3b4261",
		mdHr: "#3b4261",
		mdListBullet: "#7dcfff",
		toolDiffAdded: "#9ece6a",
		toolDiffRemoved: "#f7768e",
		toolDiffContext: "#565f89",
		syntaxComment: "#565f89",
		syntaxKeyword: "#bb9af7",
		syntaxFunction: "#7aa2f7",
		syntaxVariable: "#e0af68",
		syntaxString: "#9ece6a",
		syntaxNumber: "#ff9e64",
		syntaxType: "#2ac3de",
		syntaxOperator: "#89ddff",
		syntaxPunctuation: "#c0caf5",
		thinkingOff: "#565f89",
		thinkingMinimal: "#6183bb",
		thinkingLow: "#7aa2f7",
		thinkingMedium: "#89ddff",
		thinkingHigh: "#b4f9f8",
		thinkingXhigh: "#d2e5ff",
		bashMode: "#e0af68",
	},
	{
		selectedBg: "#33467c",
		userMessageBg: "#24283b",
		customMessageBg: "#1f2335",
		toolPendingBg: "#2f334d",
		toolSuccessBg: "#20303b",
		toolErrorBg: "#2d202a",
	},
	"truecolor",
	{ name: "drone-desktop" },
);

function unsupported(capability: string): never {
	throw new Error(`Drone Desktop does not support terminal UI capability: ${capability}`);
}

/**
 * ExtensionUIContext：select/input 通过 AskGate 桥接原生问答，confirm 通过权限门控。
 * Terminal custom components are rejected; theme changes report failure.
 * Terminal-only capabilities without a Desktop consumer reject explicitly.
 * SDK 接口变化时在这里补齐新成员，别在 PiBackend 里重写。
 */
export function makeUiContext(
	gate: PermissionGate,
	askGate?: AskGate,
	notify?: (message: string, type: "info" | "warning" | "error") => void,
	status?: (key: string, text: string | undefined) => void,
): ExtensionUIContext {
	return {
		select: async (title, options, dialogOptions) => {
			if (!askGate) unsupported("select without a question transport");
			if (dialogOptions?.timeout !== undefined) unsupported("select timeout countdown");
			if (options.length === 0) return undefined;
			const [heading = title, ...description] = title.split("\n\n");
			const response = await askGate.ask(
				{
					toolCallId: `extension-ui-select:${heading}`,
					title: heading,
					questions: [
						{
							id: "value",
							label: heading,
							prompt: description.join("\n\n") || title,
							type: "single",
							required: true,
							options: options.map((value) => ({ value, label: value })),
						},
					],
				},
				dialogOptions?.signal,
			);
			if (response.kind !== "answer" || response.mode === "elaborate") return undefined;
			const values = response.answers.value?.values;
			const selected = values?.length === 1 ? values[0] : undefined;
			return typeof selected === "string" && options.includes(selected) ? selected : undefined;
		},
		confirm: (title, message, dialogOptions) => {
			if (dialogOptions?.timeout !== undefined) unsupported("confirm timeout countdown");
			return gate.confirm(title, message, undefined, dialogOptions?.signal);
		},
		input: async (title, placeholder, dialogOptions) => {
			if (!askGate) unsupported("input without a question transport");
			if (dialogOptions?.timeout !== undefined) unsupported("input timeout countdown");
			const response = await askGate.ask(
				{
					toolCallId: `extension-ui-input:${title}`,
					title,
					questions: [
						{
							id: "value",
							label: title,
							prompt: placeholder || title,
							type: "text",
							required: false,
							options: [],
						},
					],
				},
				dialogOptions?.signal,
			);
			if (response.kind !== "answer" || response.mode === "elaborate") return undefined;
			return response.answers.value?.customText;
		},
		notify: (message, type) => {
			if (!notify) unsupported("notify without a notification transport");
			notify(message, type ?? "info");
		},
		onTerminalInput: () => unsupported("onTerminalInput"),
		setStatus: (key, text) => {
			if (!status) unsupported("setStatus without a status transport");
			status(key, text === undefined ? undefined : stripVTControlCharacters(text));
		},
		setWorkingMessage: () => unsupported("setWorkingMessage"),
		setWorkingVisible: () => unsupported("setWorkingVisible"),
		setWorkingIndicator: () => unsupported("setWorkingIndicator"),
		setHiddenThinkingLabel: () => unsupported("setHiddenThinkingLabel"),
		setWidget: () => unsupported("setWidget"),
		setFooter: () => unsupported("setFooter"),
		setHeader: () => unsupported("setHeader"),
		setTitle: () => unsupported("setTitle"),
		custom: async () => {
			throw new Error("Drone Desktop does not support terminal custom UI");
		},
		pasteToEditor: () => unsupported("pasteToEditor"),
		setEditorText: () => unsupported("setEditorText"),
		getEditorText: () => unsupported("getEditorText"),
		editor: () => unsupported("editor"),
		addAutocompleteProvider: () => unsupported("addAutocompleteProvider"),
		setEditorComponent: () => unsupported("setEditorComponent"),
		getEditorComponent: () => unsupported("getEditorComponent"),
		theme: EXTENSION_THEME,
		getAllThemes: () => [{ name: "drone-desktop", path: undefined }],
		getTheme: (name) => (name === "drone-desktop" ? EXTENSION_THEME : undefined),
		setTheme: () => ({
			success: false,
			error: "Drone Desktop does not support terminal UI themes",
		}),
		getToolsExpanded: () => unsupported("getToolsExpanded"),
		setToolsExpanded: () => unsupported("setToolsExpanded"),
	};
}
