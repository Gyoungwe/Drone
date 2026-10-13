import { buildLlmUiError } from "@drone/shared";
import type { ReactNode } from "react";
import { DeliveryCards } from "../components/chat/DeliveryCards";
import { ErrorNote } from "../components/chat/ErrorNote";
import { InlineAskCard } from "../components/chat/InlineAskCard";
import { RunStatusView } from "../components/composer/RunStatusStrip";
import { CopyIcon, GearIcon, RefreshIcon, SearchIcon, TrashIcon } from "../components/icons";
import { ContextUsageView } from "../components/panel/ContextUsageMeter";
import { HostEnvironmentView } from "../components/panel/HostEnvironmentCard";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Chip } from "../components/ui/Chip";
import { IconButton } from "../components/ui/IconButton";

/** P13：开发态状态画廊（#/__states，仅 import.meta.env.DEV）。集中渲染各 UI 状态，便于目测回归。 */
const TOKENS = [
	"--color-bg",
	"--color-surface",
	"--color-canvas",
	"--color-ink",
	"--color-ink-2",
	"--color-border",
	"--color-accent",
	"--highlight",
	"--route-accent",
	"--compute-accent",
	"--wiki-accent",
	"--zotero-accent",
];

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section style={{ marginBottom: 32 }}>
			<h2 style={{ fontSize: 15, fontWeight: 600, margin: "0 0 12px" }}>{title}</h2>
			{children}
		</section>
	);
}

const G = 1024 ** 3;
const none = { live: null, frozen: null };

export function StatesGallery() {
	const now = Date.now();
	const errors = [
		"turn process killed (exit 137)",
		"fetch failed: ECONNRESET",
		"maximum context length is 256000 tokens",
		"401 Unauthorized: invalid api key",
	].map((m) => buildLlmUiError(m, now));
	const ask = {
		id: "a1",
		sessionId: "gallery",
		questions: [
			{
				id: "q1",
				label: "归一化",
				prompt: "差异分析前用哪种归一化方法？",
				type: "single",
				required: true,
				allowCustomText: true,
				options: [
					{ value: "deseq2", label: "DESeq2 median-of-ratios", recommended: true },
					{ value: "tmm", label: "edgeR TMM" },
				],
			},
		],
	} as never;
	const files = [
		{ path: "/p/results/report.pdf", title: "差异表达分析报告", description: "DESeq2 · 1,284 个显著基因" },
		{ path: "/p/results/volcano.png", title: "火山图" },
	];
	return (
		<div className="bg-canvas" style={{ padding: 32, minHeight: "100vh", overflow: "auto", maxWidth: 960 }}>
			<h1 style={{ fontSize: 20, marginBottom: 24 }}>Drone · UI states</h1>
			<Section title="基础组件（U3）">
				<div data-testid="states-base-components" style={{ display: "grid", gap: 12 }}>
					{(["sm", "md"] as const).map((size) => (
						<div key={size} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
							<Button variant="primary" size={size}>
								主按钮
							</Button>
							<Button variant="secondary" size={size}>
								<RefreshIcon size={13} /> 刷新
							</Button>
							<Button variant="ghost" size={size}>
								取消
							</Button>
							<Button variant="danger" size={size}>
								卸载
							</Button>
							<Button variant="primary" size={size} disabled>
								禁用
							</Button>
						</div>
					))}
					<div style={{ display: "flex", gap: 4, alignItems: "center" }}>
						<IconButton label="搜索">
							<SearchIcon size={15} />
						</IconButton>
						<IconButton label="复制">
							<CopyIcon size={15} />
						</IconButton>
						<IconButton label="设置" active>
							<GearIcon size={15} />
						</IconButton>
						<IconButton label="删除" disabled>
							<TrashIcon size={15} />
						</IconButton>
					</div>
					<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
						<Chip>DESeq2</Chip>
						<Chip tone="reference">@counts.R</Chip>
						<Badge>项目</Badge>
						<Badge>扩展</Badge>
					</div>
				</div>
			</Section>
			<Section title="Tokens">
				<div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
					{TOKENS.map((v) => (
						<div key={v} style={{ width: 120, fontSize: 11 }}>
							<div
								style={{
									height: 40,
									borderRadius: 8,
									border: "1px solid var(--color-border)",
									background: `var(${v})`,
								}}
							/>
							<code>{v}</code>
						</div>
					))}
				</div>
			</Section>
			<Section title="Error cards">
				{errors.map((e, i) => (
					<ErrorNote key={e.code} sessionId="gallery" cardId={`g${i}`} error={e} />
				))}
			</Section>
			<Section title="Ask card">
				<div className="inline-ask-dock">
					<InlineAskCard request={ask} receivedAt={now - 42000} onRespond={async () => {}} />
				</div>
			</Section>
			<Section title="Run states (P14)">
				<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
					<RunStatusView state="HostInit" planLabel={null} runningSteps={0} thinking={none} zh />
					<RunStatusView
						state="Thinking"
						planLabel={null}
						runningSteps={0}
						thinking={{ live: "思考中 7s", frozen: null }}
						zh
					/>
					<RunStatusView state="Running" planLabel="下一步：定量 2/3" runningSteps={3} thinking={none} zh />
					<RunStatusView
						state="AwaitingInput"
						planLabel="下一步：差异分析 3/3"
						runningSteps={1}
						thinking={none}
						zh
					/>
				</div>
			</Section>
			<Section title="Context usage (P16)">
				<div style={{ width: 340 }}>
					{[20.6, 71, 91.5].map((percent) => (
						<ContextUsageView
							key={percent}
							usage={{ tokens: percent * 2000, contextWindow: 200000, percent }}
							compacting={false}
							disabled={false}
							onCompact={() => {}}
						/>
					))}
				</div>
			</Section>
			<Section title="Delivery cards (P17)">
				<div style={{ width: 560 }}>
					<DeliveryCards files={files} sessionId={null} />
				</div>
			</Section>
			<Section title="Host environment (P10)">
				<div style={{ width: 380 }}>
					<HostEnvironmentView
						env={{
							os: "macOS",
							kernel: "24.1.0",
							arch: "arm64",
							hostname: "demo.local",
							cpu: { model: "Apple M3 Pro", cores: 12, loadPercent: 23 },
							memory: { totalBytes: 36 * G, freeBytes: 13 * G },
							disk: { path: "/Users/demo", totalBytes: 994 * G, freeBytes: 402 * G },
							tools: [
								{ id: "python", label: "Python", version: "3.12.4" },
								{ id: "docker", label: "Docker", version: null },
							],
							pythonPackages: 214,
							npmPackages: 9,
							probedAt: "",
						}}
						loading={false}
						onRefresh={() => {}}
					/>
				</div>
			</Section>
		</div>
	);
}
