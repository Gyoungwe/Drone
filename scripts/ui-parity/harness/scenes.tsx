import { buildLlmUiError, groupProcessRows } from "@drone/shared";
import App from "@renderer/App";
import { ErrorNote } from "@renderer/components/chat/ErrorNote";
import { MetaGroup } from "@renderer/components/chat/MetaGroup";
import { ProcessBlock } from "@renderer/components/chat/ProcessBlock";
import { ProgressNote } from "@renderer/components/chat/ProgressNote";
import { Composer } from "@renderer/components/composer/Composer";
import { ResourceSidebar } from "@renderer/components/diff/ResourceSidebar";
import { SessionOverviewSections } from "@renderer/components/panel/SessionOverviewSections";
import { SessionRow } from "@renderer/components/projects/SessionRow";
import { MemorySettingsView } from "@renderer/components/settings/MemorySettingsRow";
import { useI18nStore } from "@renderer/i18n";
import { useSettingsStore } from "@renderer/stores/settings";
import {
	selectTranscript,
	selectTranscript as selT,
	useTranscriptStore,
	useTranscriptStore as useTS,
} from "@renderer/stores/transcript";
import { useUiStore } from "@renderer/stores/ui";
import type { ComponentType } from "react";
import { DeliveryCards } from "../../../packages/desktop/src/renderer/src/components/chat/DeliveryCards";
import { InlineAskCard } from "../../../packages/desktop/src/renderer/src/components/chat/InlineAskCard";
import { ComposerStatusView } from "../../../packages/desktop/src/renderer/src/components/composer/ComposerStatusBar";
import { ModePicker } from "../../../packages/desktop/src/renderer/src/components/composer/ModePicker";
import { RunStatusView } from "../../../packages/desktop/src/renderer/src/components/composer/RunStatusStrip";
import { ContextUsageView } from "../../../packages/desktop/src/renderer/src/components/panel/ContextUsageMeter";
import {
	HostEnvironmentView,
	HostPermissions,
} from "../../../packages/desktop/src/renderer/src/components/panel/HostEnvironmentCard";
import { DesktopSettings } from "../../../packages/desktop/src/renderer/src/components/settings/DesktopSettings";
import { StatesGallery } from "../../../packages/desktop/src/renderer/src/dev/StatesGallery";
import { useAgentModeStore } from "../../../packages/desktop/src/renderer/src/stores/agent-mode";
import { useDesktopPrefsStore } from "../../../packages/desktop/src/renderer/src/stores/desktop-prefs";
import { mrcBytes, niftiBytes, tiffBytes } from "../../../packages/shared/src/p4-fixtures";
import { fixtures, stubPreview } from "./fixtures";

function Side({ fixture }: { fixture: keyof typeof fixtures }) {
	const f = fixtures[fixture];
	if (!f) return null;
	stubPreview(f);
	return (
		<div
			style={{
				width: 640,
				height: 600,
				display: "flex",
				flexDirection: "column",
				border: "1px solid #e5e5e5",
				margin: 12,
			}}
			className="bg-surface"
		>
			<div className="context-pane-fill resource-sidebar">
				<ResourceSidebar target={{ href: f.path, cwd: "/proj" }} />
			</div>
		</div>
	);
}
function Errors({ dark }: { dark?: boolean }) {
	document.documentElement.dataset.theme =
		dark || new URLSearchParams(location.search).get("theme") === "dark" ? "dark" : "light";
	const cases = [
		buildLlmUiError("turn process killed (exit 137)", Date.now()),
		buildLlmUiError("fetch failed: ECONNRESET", Date.now()),
		buildLlmUiError("maximum context length is 256000 tokens", Date.now()),
		buildLlmUiError("401 Unauthorized: invalid api key", Date.now()),
	];
	return (
		<div className="bg-canvas" style={{ padding: 24, width: 640, minHeight: 600 }}>
			{cases.map((e, i) => (
				<ErrorNote key={i} sessionId="s1" cardId={`e${i}`} error={e} />
			))}
		</div>
	);
}

import { SearchPaletteView } from "@renderer/components/search/SearchPalette";

function Search() {
	const items = [
		{
			kind: "project" as const,
			id: "/p/rna",
			title: "rnaseq-liver",
			subtitle: "~/research/rnaseq-liver",
			pinned: true,
			lastActive: 9,
		},
		{
			kind: "task" as const,
			id: "1",
			title: "RNA-seq 差异表达分析并出火山图",
			subtitle: "rnaseq-liver",
			pinned: true,
			lastActive: 8,
		},
		{
			kind: "task" as const,
			id: "2",
			title: "检索 DHX16 植物功能证据",
			subtitle: "plant-dhx16",
			pinned: false,
			lastActive: 7,
		},
		{ kind: "task" as const, id: "3", title: "写综述 related work 小节", pinned: false, lastActive: 6 },
		{
			kind: "project" as const,
			id: "/p/dhx",
			title: "plant-dhx16",
			subtitle: "~/research/plant-dhx16",
			pinned: false,
			lastActive: 5,
		},
	];
	return (
		<div className="bg-canvas" style={{ width: 900, height: 600 }}>
			<SearchPaletteView items={items} onPick={() => {}} onClose={() => {}} />
		</div>
	);
}

import { ContextMenuView } from "@renderer/components/ui/ContextMenu";
import { buildFileMenu, buildTabMenu } from "@renderer/components/ui/file-menu";
import { useT } from "@renderer/i18n";
import { useSessionsStore } from "@renderer/stores/sessions";

function Menus() {
	const t = useT();
	useSessionsStore.setState({
		sessions: ["a", "b", "c"].map((id) => ({
			sessionId: id,
			sessionFile: `/s/${id}.jsonl`,
			cwd: "/p",
			active: true,
			messageCount: 1,
			createdAt: 0,
		})),
		activeSessionId: "b",
	});
	return (
		<div className="bg-canvas" style={{ width: 600, height: 480, position: "relative" }}>
			<ContextMenuView
				x={20}
				y={20}
				groups={buildFileMenu({ path: "/p/results/volcano.png", cwd: "/p" }, t)}
				onClose={() => {}}
			/>
			<ContextMenuView x={320} y={20} groups={buildTabMenu("b", t, () => {})} onClose={() => {}} />
		</div>
	);
}
function Ask() {
	const req = {
		id: "a1",
		sessionId: "s1",
		questions: [
			{
				id: "q1",
				label: "归一化",
				prompt: "差异分析前用哪种归一化方法？",
				type: "single",
				required: true,
				allowCustomText: true,
				options: [
					{
						value: "deseq2",
						label: "DESeq2 median-of-ratios",
						description: "计数数据首选",
						recommended: true,
					},
					{ value: "tmm", label: "edgeR TMM" },
					{ value: "tpm", label: "TPM", description: "仅用于展示" },
				],
			},
			{ id: "q2", label: "阈值", prompt: "显著性阈值？", type: "text", required: false, options: [] },
		],
	} as never;
	return (
		<div style={{ padding: 24, background: "var(--color-bg)" }}>
			<div className="inline-ask-dock">
				<InlineAskCard request={req} receivedAt={Date.now() - 42000} onRespond={async () => {}} />
			</div>
			<div className="ask-receipt">你回复了「DESeq2 median-of-ratios」· 18s</div>
		</div>
	);
}
function HostEnv() {
	const G = 1024 ** 3;
	const env = {
		os: "macOS (Darwin 24.1.0)",
		kernel: "24.1.0",
		arch: "arm64",
		hostname: "yangwei-mbp.local",
		cpu: { model: "Apple M3 Pro", cores: 12, loadPercent: 23 },
		memory: { totalBytes: 36 * G, freeBytes: 13 * G },
		disk: { path: "/Users/yw", totalBytes: 994 * G, freeBytes: 402 * G },
		tools: [
			{ id: "node", label: "Node.js", version: "22.11.0" },
			{ id: "python", label: "Python", version: "3.12.4" },
			{ id: "git", label: "Git", version: "2.45.1" },
			{ id: "conda", label: "Conda", version: "24.7.1" },
			{ id: "R", label: "R", version: "4.4.1" },
			{ id: "docker", label: "Docker", version: null },
		],
		pythonPackages: 214,
		npmPackages: 9,
		probedAt: "",
	};
	return (
		<div className="context-pane bg-surface" style={{ width: 380, padding: 16 }}>
			<HostEnvironmentView env={env} loading={false} onRefresh={() => {}} />
			<HostPermissions
				authState="ready"
				managed={false}
				capabilities={["slurm 23.02", "singularity 3.11"]}
				workspaceRoot="/scratch/yw/drone"
				defaultOpen
			/>
		</div>
	);
}
function Desktop() {
	useDesktopPrefsStore.setState({
		prefs: {
			notifyInBackground: true,
			completionSound: true,
			openAtLogin: false,
			menuBarIcon: true,
			downloadDir: "/Users/yw/Drone 下载",
		},
	});
	return (
		<div className="settings-rows" style={{ width: 640, padding: 24 }}>
			<DesktopSettings />
		</div>
	);
}
function Usage() {
	return (
		<div className="context-pane bg-surface" style={{ width: 340, padding: 16 }}>
			<ContextUsageView
				usage={{ tokens: 41200, contextWindow: 200000, percent: 20.6 }}
				compacting={false}
				disabled={false}
				onCompact={() => {}}
			/>
			<ContextUsageView
				usage={{ tokens: 142000, contextWindow: 200000, percent: 71 }}
				compacting={false}
				disabled={false}
				onCompact={() => {}}
			/>
			<ContextUsageView
				usage={{ tokens: 183000, contextWindow: 200000, percent: 91.5 }}
				compacting={true}
				disabled={false}
				onCompact={() => {}}
			/>
		</div>
	);
}
function Delivery() {
	const files = [
		{ path: "/p/results/report.pdf", title: "差异表达分析报告", description: "DESeq2 · 1,284 个显著基因" },
		{ path: "/p/results/volcano.png", title: "火山图", description: "padj < 0.05, |log2FC| > 1" },
		{ path: "/p/results/counts.tsv", title: "counts.tsv", description: "标准化计数矩阵" },
	];
	return (
		<div style={{ display: "flex", gap: 24, padding: 24 }}>
			<div style={{ width: 560 }}>
				<DeliveryCards files={files} sessionId={null} />
			</div>
			<div className="context-pane bg-surface" style={{ width: 300 }}>
				<section className="panel-card">
					<header>交付物</header>
					<DeliveryCards files={files} sessionId={null} />
				</section>
			</div>
		</div>
	);
}
function RunStates() {
	const none = { live: null, frozen: null };
	return (
		<div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10, width: 800 }}>
			<RunStatusView state="HostInit" planLabel={null} runningSteps={0} thinking={none} zh />
			<RunStatusView
				state="Thinking"
				planLabel={null}
				runningSteps={0}
				thinking={{ live: "思考中 7s", frozen: null }}
				zh
			/>
			<RunStatusView
				state="Running"
				planLabel="下一步：定量 2/3"
				runningSteps={3}
				thinking={{ live: null, frozen: "深度思考 4.2s" }}
				zh
			/>
			<RunStatusView
				state="AwaitingInput"
				planLabel="下一步：差异分析 3/3"
				runningSteps={1}
				thinking={none}
				zh
			/>
			<RunStatusView
				state="Streaming"
				planLabel="全部步骤已完成 3/3"
				runningSteps={0}
				thinking={{ live: null, frozen: "深度思考 4.2s" }}
				zh
			/>
		</div>
	);
}
const b64u = (u: Uint8Array) => {
	let s = "";
	for (const b of u) s += String.fromCharCode(b);
	return btoa(s);
};
function P4Tiff() {
	const data = b64u(
		tiffBytes({
			w: 256,
			h: 192,
			bits: 16,
			pages: 12,
			pixel: (x, y) =>
				Math.round(
					30000 +
						25000 * Math.sin(x / 18) * Math.cos(y / 14) +
						8000 * Math.exp(-((x - 170) ** 2 + (y - 80) ** 2) / 600),
				),
		}),
	);
	stubPreview({
		path: "/proj/stack.tif",
		name: "stack.tif",
		mimeType: "image/tiff",
		size: 1200000,
		kind: "binary",
		previewKind: "tiff",
		data,
	});
	return <Frame />;
}
function P4Volume() {
	const n = 48;
	const data = b64u(
		niftiBytes([n, n, 40], (x, y, z) => {
			const d = Math.hypot(x - n / 2, y - n / 2, (z - 20) * 1.2);
			const blob = Math.hypot(x - 30, y - 18, z - 26);
			return (d < 18 ? 400 + 200 * Math.cos(d / 2) : 0) + (blob < 6 ? 900 : 0);
		}),
	);
	stubPreview({
		path: "/proj/brain.nii.gz",
		name: "brain.nii",
		mimeType: "application/x-nifti",
		size: 380000,
		kind: "binary",
		previewKind: "volume",
		data,
		compression: "gzip",
	});
	return <Frame />;
}
function Frame() {
	return (
		<div
			style={{
				width: 640,
				height: 600,
				display: "flex",
				flexDirection: "column",
				border: "1px solid #e5e5e5",
				margin: 12,
			}}
			className="bg-surface"
		>
			<div className="context-pane-fill resource-sidebar">
				<ResourceSidebar target={{ href: "/proj/x", cwd: "/proj" }} />
			</div>
		</div>
	);
}
void mrcBytes;
function P14More() {
	const tool = (name: string, key: string) => ({
		key,
		id: key,
		name,
		args: "{}",
		output: "",
		state: "done" as const,
	});
	const rows = [
		{
			kind: "metaGroup",
			key: "g1",
			items: [{ tools: [tool("read", "t1"), tool("edit", "t2")] }],
			working: false,
			subagentCount: 0,
		},
		{
			kind: "message",
			key: "a1",
			message: {
				kind: "assistant",
				id: "a1",
				text: "已改好 counts.R 的前两步。",
				thinking: "",
				tools: [],
				timestamp: 1,
				stopped: true,
			},
			metaInGroup: true,
			showActions: true,
			streaming: false,
		},
	] as never[];
	const seg = groupProcessRows(rows)[0] as never;
	const meta = (id: string, name: string, n: number) =>
		({
			sessionId: id,
			sessionFile: `/s/${id}.jsonl`,
			cwd: "/proj",
			name,
			messageCount: n,
			createdAt: Date.now() - 3600e3,
			modifiedAt: Date.now() - 120e3,
		}) as never;
	return (
		<div className="bg-canvas" style={{ padding: 16, width: 760, display: "flex", gap: 16 }}>
			<div style={{ flex: 1 }}>
				<p style={{ fontSize: 12, color: "#888", margin: "0 0 6px" }}>
					Stopped：折叠组末尾「已停止」，已写内容保留
				</p>
				<ProcessBlock segment={seg}>
					<div style={{ padding: 8, fontSize: 12 }}>读取 counts.R · 编辑 counts.R</div>
				</ProcessBlock>
				<p style={{ fontSize: 13, margin: "8px 0 0" }}>已改好 counts.R 的前两步。</p>
			</div>
			<div style={{ width: 280 }}>
				<h3 className="pt-1 pb-2 text-[13px] font-medium text-ink-dim">进行中</h3>
				<ul className="flex flex-col gap-0.5">
					<SessionRow session={meta("s1", "RNA-seq 差异分析", 18)} live="running" />
					<SessionRow session={meta("s2", "火山图配色", 6)} live="awaiting" />
				</ul>
				<h3 className="pt-4 pb-2 text-[13px] font-medium text-ink-dim">今天</h3>
				<ul className="flex flex-col gap-0.5">
					<SessionRow session={meta("s3", "质控报告", 9)} />
				</ul>
			</div>
		</div>
	);
}
function ModeScene() {
	useSessionsStore.setState({ activeSessionId: "s1" } as never);
	useAgentModeStore.setState({
		bySession: { s1: "single" },
		lastChange: { sessionId: "s1", mode: "single", added: [], removed: ["subagent"] },
	});
	return (
		<div style={{ padding: "90px 24px 24px", width: 760 }}>
			<ComposerStatusView host="本机" project="rnaseq-2026" dir="~/projects/rnaseq-2026" />
			<div
				className="composer-model-group"
				style={{
					display: "inline-flex",
					border: "1px solid var(--color-border)",
					borderRadius: 10,
					marginTop: 8,
				}}
			>
				<ModePicker />
			</div>
		</div>
	);
}
function Memory() {
	useI18nStore.setState({ language: "zh" } as never);
	return (
		<div style={{ padding: 24, width: 760 }} className="bg-surface">
			<ComposerStatusView
				host="本机"
				project="rnaseq-2026"
				dir="~/projects/rnaseq-2026"
				memory="已载入 5 条记忆"
			/>
			<div className="settings-rows" style={{ marginTop: 24 }}>
				<MemorySettingsView
					status={{ enabled: true, count: 37, lastLoaded: 5 }}
					onToggle={() => {}}
					onClear={() => {}}
				/>
				<MemorySettingsView
					status={{ enabled: false, count: 0, lastLoaded: 0 }}
					onToggle={() => {}}
					onClear={() => {}}
				/>
			</div>
		</div>
	);
}
function ThinkingScene() {
	useI18nStore.setState({ language: "zh" } as never);
	const now = Date.now();
	const tool = {
		key: "t1",
		id: "t1",
		name: "read",
		args: '{"path":"counts.R"}',
		output: "",
		state: "done",
		startedAt: now - 3000,
		endedAt: now - 2200,
	};
	setTimeout(() => {
		for (const d of Array.from(document.querySelectorAll("details"))) d.open = true;
	}, 600);
	const lbl = (s: string) => (
		<div className="text-meta text-ink-faint" style={{ margin: "16px 0 4px" }}>
			{s}
		</div>
	);
	return (
		<div className="bg-canvas" style={{ padding: 24, width: 760 }}>
			{lbl("① 思考中（实时计时）")}
			<MetaGroup
				items={[{ thinking: "先看 counts.R 的过滤阈值……", thinkingStartedAt: now - 7400, tools: [] }]}
				working
			/>
			{lbl("② 思考结束（首个工具到达时冻结）")}
			<MetaGroup
				items={[
					{
						thinking: "需要读取 counts.R 确认归一化方法。",
						thinkingStartedAt: now - 9000,
						thinkingEndedAt: now - 4800,
						tools: [tool as never],
					},
				]}
				working={false}
			/>
			{lbl("③ 历史会话（无持久化思考时间 → 仅「思考」标签）")}
			<MetaGroup items={[{ thinking: "旧会话的思考内容", tools: [] }]} working={false} />
			<script />
		</div>
	);
}
function HistoryDurations({ derive }: { derive?: boolean }) {
	useI18nStore.setState({ language: "zh" } as never);
	setTimeout(() => {
		for (const d of Array.from(document.querySelectorAll("details"))) d.open = true;
	}, 600);
	const s0 = 1_000_000;
	const t = (key: string, name: string, args: string, end: number, known = true) => ({
		key,
		id: key,
		name,
		args,
		output: "",
		state: "done",
		endedAt: s0 + end,
		...(derive && known ? { startedAt: s0 } : {}),
	});
	const lbl = (x: string) => (
		<div className="text-meta text-ink-faint" style={{ margin: "16px 0 4px" }}>
			{x}
		</div>
	);
	return (
		<div className="bg-canvas" style={{ padding: 24, width: 760 }}>
			{lbl(
				derive
					? "历史会话 · 由 assistant entry 落盘时刻推导工具起点"
					: "历史会话 · 修复前（无起点 → 不显示时长）",
			)}
			<MetaGroup
				items={[
					{
						thinking: "",
						tools: [
							t("a", "read", '{"path":"counts.R"}', 320),
							t("b", "bash", '{"command":"Rscript counts.R"}', 18400),
							t("c", "webfetch", '{"url":"https://europepmc.org/x"}', 2100),
						] as never,
					},
				]}
				working={false}
			/>
			{lbl("缺 entry 时间的旧条目：不显示时长，行高与对齐不变")}
			<MetaGroup
				items={[
					{
						thinking: "",
						tools: [
							t("d", "read", '{"path":"README.md"}', 500, false),
							t("e", "grep", '{"pattern":"DESeq2"}', 900),
						] as never,
					},
				]}
				working={false}
			/>
		</div>
	);
}
function Timeline({ done }: { done?: boolean }) {
	useI18nStore.setState({ language: "zh" } as never);
	const tool = (name: string, key: string, state: "done" | "running" = "done") => ({
		key,
		id: key,
		name,
		args: '{"url":"https://europepmc.org/x"}',
		output: "",
		state,
		startedAt: 1000,
		endedAt: 1000 + 800 + key.charCodeAt(0) * 37,
	});
	const group = (k: string, n: number, running = false) => (
		<MetaGroup
			key={k}
			items={[
				{
					thinking: "",
					tools: Array.from({ length: n }, (_, i) =>
						tool("webfetch", `${k}${i}`, running && i === n - 1 ? "running" : "done"),
					),
				},
			]}
			working={running}
		/>
	);
	const note = (k: string, text: string, detail: string, next: string) => (
		<ProgressNote key={k} progress={{ kind: "plan", text, detail, next } as never} />
	);
	const seg = {
		working: !done,
		stages: 3,
		tools: 11,
		subagents: 0,
		stopped: false,
		latestStage: { text: "深度检索剩余文献信息" },
		statusText: "深度检索剩余文献信息",
	} as never;
	return (
		<div className="bg-canvas" style={{ padding: 24, width: 760 }}>
			<ProcessBlock segment={seg}>
				{group("a", 4)}
				{note(
					"n1",
					"检索 C5-C8 目标文献详情",
					"获取 Cunningham 2020 摘要，并检索 Mukherjee (C5)、Kang (C6)、Sanders (C7) 与 Tanjore (C8)。",
					"获取 C5-C8 目标文献详情",
				)}
				{group("b", 4)}
				{note(
					"n2",
					"获取 C7/C8 文献详情",
					"检索 Tanjore (C8)、Sanders (C7)、Cunningham (C8) 的准确文献摘要与记录。",
					"获取 Tanjore、Sanders、Cunningham 的 PubMed 摘要",
				)}
				{group("c", 3)}
				{note(
					"n3",
					"深度检索剩余文献信息",
					"在 Europe PMC 深度检索 C5 (Mukherjee、Sanyal)、C6 (Kang)、C7 (Sanders, Hinz)、C4 (Ohnishi) 的确切文献信息。",
					"多维度检索剩余文献记录",
				)}
				{group("d", 2, true)}
			</ProcessBlock>
		</div>
	);
}
function TimelineDone() {
	setTimeout(() => {
		(document.querySelector(".process-block-head") as HTMLElement | null)?.click();
		setTimeout(() => document.querySelectorAll("details").forEach((d) => d.setAttribute("open", "")), 300);
	}, 300);
	return <Timeline done />;
}
function RightPanel({ fresh }: { fresh?: boolean }) {
	useI18nStore.setState({ language: "zh" } as never);
	const tool = (name: string, k: string, args: string) => ({
		key: k,
		id: k,
		name,
		args,
		output: "",
		state: "done",
	});
	const a = (id: string, text: string, tools: unknown[]) => ({
		kind: "assistant",
		id,
		text: "",
		thinking: "",
		tools,
		timestamp: 1,
		progress: { kind: "plan", text },
	});
	const messages = [
		{ kind: "user", id: "u", text: "整理综述引用", timestamp: 1 },
		a("a1", "检索 C5-C8 目标文献详情", [
			tool("webfetch", "t1", "{}"),
			tool("webfetch", "t2", "{}"),
			tool("read", "t3", '{"path":"refs.md"}'),
		]),
		a("a2", "获取 C7/C8 文献详情", [
			tool("webfetch", "t4", "{}"),
			tool("edit", "t5", '{"path":"/proj/review/references.md"}'),
		]),
		a("a3", "深度检索剩余文献信息", [
			tool("webfetch", "t6", "{}"),
			tool("write", "t7", '{"path":"/proj/review/citations.bib"}'),
		]),
	];
	const st = useTranscriptStore.getState() as never as { bySession: Record<string, unknown> };
	const base = selectTranscript(st as never, null);
	void st;
	useTranscriptStore.setState({
		bySession: {
			s1: { ...(base as object), messages: fresh ? [] : messages, agentActive: !fresh, compacting: false },
		},
	} as never);
	return (
		<div className="bg-surface context-pane" style={{ width: 320, padding: 16, minHeight: 560 }}>
			<ContextUsageView
				usage={{ tokens: 128000, contextWindow: 1000000, percent: 12.8 } as never}
				compacting={false}
				disabled
				onCompact={() => {}}
			/>
			<SessionOverviewSections sessionId="s1" />
		</div>
	);
}
function ComposerScene({ openMode, note }: { openMode?: boolean; note?: boolean }) {
	useI18nStore.setState({ language: "zh" } as never);
	const stats = {
		inputTokens: 210000,
		outputTokens: 18000,
		cacheReadTokens: 1000000,
		cacheWriteTokens: 2000,
		totalTokens: 1230000,
		requests: 42,
		cost: 0,
	};
	const usage = { tokens: 128000, contextWindow: 1000000, percent: 12.8 };
	const fn = (name: string) => async () =>
		name === "getStats" ? stats : name === "getContextUsage" ? usage : name.startsWith("list") ? [] : null;
	(window as never as { pi: unknown }).pi = new Proxy(
		{},
		{ get: (_t, k) => (k === "on" || String(k).startsWith("on") ? () => () => {} : fn(String(k))) },
	);
	useSessionsStore.setState({
		activeSessionId: "s1",
		cwd: "/proj/rnaseq-2026",
		sessions: [{ sessionId: "s1", cwd: "/proj/rnaseq-2026" }],
	} as never);
	useAgentModeStore.setState({
		bySession: { s1: note ? "single" : "lead" },
		lastChange: note
			? { sessionId: "s1", mode: "single", added: [], removed: ["subagent", "delegate"] }
			: null,
	} as never);
	useTS.setState({
		bySession: {
			s1: {
				...selT(useTS.getState(), null),
				messages: [{ kind: "user", id: "u", text: "hi", timestamp: 1 }],
				agentActive: true,
				compacting: false,
			},
		},
	} as never);
	if (openMode)
		setTimeout(() => {
			const rc = document.querySelector("[data-testid=run-config-picker] > button") as HTMLElement | null;
			if (rc) {
				rc.click();
				setTimeout(
					() => (document.querySelector("[data-testid=mode-picker]") as HTMLElement | null)?.click(),
					300,
				);
			} else (document.querySelector("[data-testid=mode-picker]") as HTMLElement | null)?.click();
		}, 800);
	else
		setTimeout(
			() => document.querySelector("svg[aria-label*=上下文]")?.parentElement?.classList.add("shot-hover"),
			800,
		);
	return (
		<div className="bg-canvas" style={{ padding: "300px 24px 24px", width: 1000 }}>
			<div style={{ width: 720 }}>
				<style>{".shot-hover > div { opacity: 1 !important; }"}</style>
				<Composer />
			</div>
		</div>
	);
}
function AppScene({ view, dark, setup }: { view?: string; dark?: boolean; setup?: () => void }) {
	useI18nStore.setState({ language: "zh" } as never);
	document.documentElement.dataset.theme =
		dark || new URLSearchParams(location.search).get("theme") === "dark" ? "dark" : "light";
	const now = Date.now();
	const sessions = [
		{
			sessionId: "s1",
			cwd: "/home/u/projects/rnaseq-2026",
			name: "整理综述引用并核对 DOI",
			sessionFile: "/s1.jsonl",
			modifiedAt: now - 6e5,
			createdAt: now - 9e5,
			messageCount: 12,
		},
		{
			sessionId: "s2",
			cwd: "/home/u/projects/rnaseq-2026",
			name: "差异表达分析 DESeq2",
			sessionFile: "/s2.jsonl",
			modifiedAt: now - 3.6e6,
			createdAt: now - 4e6,
			messageCount: 30,
		},
		{
			sessionId: "s3",
			cwd: "/home/u/日常",
			name: "检索 DHX16 植物功能证据",
			sessionFile: "/s3.jsonl",
			modifiedAt: now - 8.6e7,
			createdAt: now - 9e7,
			messageCount: 8,
		},
		{
			sessionId: "s4",
			cwd: "/home/u/projects/thesis",
			name: "第三章引言润色",
			sessionFile: "/s4.jsonl",
			modifiedAt: now - 2.6e8,
			createdAt: now - 3e8,
			messageCount: 21,
		},
	];
	const data: Record<string, unknown> = {
		listSessions: sessions,
		listAllSessions: sessions,
		getSessions: sessions,
		platform: "linux",
		uiPluginsGetConfig: { enabled: false, plugins: {}, slots: {} },
		uiPluginsList: [],
	};
	(window as never as { pi: unknown }).pi = new Proxy({ platform: "linux" } as Record<string, unknown>, {
		get: (t, k: string) =>
			k in t
				? t[k]
				: k.startsWith("on")
					? () => () => {}
					: () => Promise.resolve(data[k] ?? (k.startsWith("list") ? [] : undefined)),
	});
	if (view) useUiStore.setState({ view } as never);
	useTS.setState({ bySession: { s1: { ...selT(useTS.getState(), null), agentActive: true } } } as never);
	setup?.();
	return <App />;
}
export const scenes: Record<string, ComponentType> = {
	"app-home": () => <AppScene />,
	"app-home-dark": () => <AppScene dark />,
	"app-knowledge": () => <AppScene view="knowledge" />,
	"app-knowledge-dark": () => <AppScene view="knowledge" dark />,
	"app-projects": () => <AppScene view="projects" />,
	"app-projects-dark": () => <AppScene view="projects" dark />,
	"app-settings": () => (
		<AppScene setup={() => setTimeout(() => useSettingsStore.getState().openWith("models" as never), 300)} />
	),
	"app-settings-general": () => (
		<AppScene setup={() => setTimeout(() => useSettingsStore.getState().openWith("general" as never), 300)} />
	),
	"app-settings-dark": () => (
		<AppScene
			dark
			setup={() => setTimeout(() => useSettingsStore.getState().openWith("models" as never), 300)}
		/>
	),
	"ui-composer": () => <ComposerScene />,
	"ui-composer-mode": () => <ComposerScene openMode />,
	"ui-composer-note": () => <ComposerScene note />,
	"ui-right-panel": () => <RightPanel />,
	"ui-fresh-panel": () => <RightPanel fresh />,
	"ui-timeline": () => <Timeline />,
	"ui-timeline-done": () => <TimelineDone />,
	"ui-history-durations": () => <HistoryDurations derive />,
	"ui-history-durations-old": () => <HistoryDurations />,
	"ui-thinking": () => <ThinkingScene />,
	memory: () => <Memory />,
	"p13-gallery": () => <StatesGallery />,
	"p18-mode": () => <ModeScene />,
	"p14-run-states": () => <RunStates />,
	"p14-stopped-sidebar": () => <P14More />,
	"p4-tiff": () => <P4Tiff />,
	"p4-volume": () => <P4Volume />,
	"p17-delivery": () => <Delivery />,
	"p16-usage": () => <Usage />,
	"p11-desktop": () => <Desktop />,
	"p10-hostenv": () => <HostEnv />,
	"p9-ask": () => <Ask />,
	"p3-notebook": () => <Side fixture="notebook" />,
	"p3-mermaid": () => <Side fixture="mermaid" />,
	"p3-csv": () => <Side fixture="csv" />,
	"p3-audio": () => <Side fixture="audio" />,
	"p4-npy": () => <Side fixture="npy" />,
	"p4-mesh": () => <Side fixture="mesh" />,
	"p4-latex": () => <Side fixture="latex" />,
	"p8-errors": () => <Errors />,
	"p6-search": () => <Search />,
	"p7-menus": () => <Menus />,
	"p8-errors-dark": () => <Errors dark />,
};
