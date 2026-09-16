// Isolated fixture drives actual reducer + MessageList; no live provider or user session mutation.

import type { SessionEvent } from "@percho/shared";
import { MessageList } from "../../packages/desktop/src/renderer/src/components/chat/MessageList";
import { useTranscriptStore } from "../../packages/desktop/src/renderer/src/stores/transcript";

const call = (id: string, name: string, args: Record<string, unknown> = {}) => ({
	type: "toolCall",
	id,
	name,
	arguments: args,
});
const fixtureEpoch = Date.now();
const response = (id: string, content: unknown[], offset: number) => ({
	role: "assistant",
	responseId: id,
	content,
	timestamp: fixtureEpoch + offset,
	stopReason: "toolUse",
	usage: { input: 200, output: 100, cacheRead: 800, cacheWrite: 0, cost: { total: 0 } },
});
const a = response(
	"stage-1",
	[
		call("p1", "set_status"),
		call("r1", "read", { path: "Wiki/Topic.md" }),
		call("g1", "grep", { pattern: "条件与版本" }),
	],
	2000,
);
const b = response(
	"stage-2",
	[call("p2", "set_status"), call("w1", "webfetch", { url: "https://example.invalid/manual" })],
	3000,
);
const c = response("stage-3", [call("p3", "set_status")], 4000);
const finish = {
	...response(
		"stage-4",
		[
			{
				type: "text",
				text: "**本轮交付说明**：已整理来源入口；仍需核验软件版本。这里是隔离 UI 测试，不代表真实文献结论。",
			},
		],
		5000,
	),
	stopReason: "stop",
};
const event = (type: string, extra: Record<string, unknown> = {}) =>
	useTranscriptStore
		.getState()
		.applyEvent("fixture", { type, ...extra } as SessionEvent, { isActiveViewing: true });
const result = (id: string, name: string, details: Record<string, unknown> = {}) =>
	event("tool_execution_end", {
		toolCallId: id,
		toolName: name,
		isError: false,
		result: { details, content: [{ type: "text", text: "Observed fixture result" }] },
	});
(window as any).stageTimelineFixture = {
	status(text: string, taskView?: unknown) {
		useTranscriptStore.getState().resetSession("fixture");
		event("message_end", {
			message: {
				role: "custom",
				customType: "percho-task-status",
				display: true,
				content: text,
				timestamp: Date.now(),
				details: { reportId: "ui-status-1", taskView },
			},
		});
	},
	start() {
		useTranscriptStore.getState().resetSession("fixture");
		event("agent_start");
		event("message_start", {
			message: { role: "user", content: "请分阶段查资料，解释选择，再总结结果。", timestamp: fixtureEpoch },
		});
		event("turn_start");
		event("message_end", { message: a });
	},
	first() {
		result("p1", "set_status", {
			status: "先定位主题和已有证据",
			kind: "plan",
			detail: "先看知识库的已有范围，再决定哪些资料需要补查。",
			next: "读取主题页并查找版本与适用条件。",
		});
	},
	next() {
		result("r1", "read");
		result("g1", "grep");
		event("turn_end", { message: a, toolResults: [] });
		event("turn_start");
		event("message_end", { message: b });
		result("p2", "set_status", {
			status: "补查缺失的软件参数",
			kind: "update",
			detail: "现有笔记给出了资料入口，但没有完整的参数约束。",
			next: "读取官方手册对应章节。",
		});
	},
	done() {
		result("w1", "webfetch");
		event("turn_end", { message: b, toolResults: [] });
		event("turn_start");
		event("message_end", { message: c });
		result("p3", "set_status", {
			status: "本阶段小结：明确已知与缺口",
			kind: "summary",
			detail: "已经整理来源入口；版本适配和本机性能尚未验证。",
			next: "把产物与未完成事项一起交付。",
		});
		event("turn_end", { message: c, toolResults: [] });
		event("turn_start");
		event("message_end", { message: finish });
		event("turn_end", { message: finish, toolResults: [] });
		event("agent_settled");
	},
};
export function StageTimelineFixture() {
	return (
		<section
			id="stage-timeline-fixture"
			style={{ display: "none" }}
			className="mt-4 rounded-xl border border-border bg-surface"
		>
			<div className="px-4 pt-3 text-[10px] text-ink-dim">
				隔离执行顺序验收 · 实际 MessageList / reducer · 模拟工具事件
			</div>
			<div style={{ height: 710 }}>
				<MessageList />
			</div>
		</section>
	);
}
