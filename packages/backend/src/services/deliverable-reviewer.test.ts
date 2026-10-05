import type {
	DeliverableReviewFinding,
	DeliverableReviewSnapshot,
	ReviewerProviderSelection,
} from "@drone/knowledge";
import { describe, expect, it, vi } from "vitest";
import { DeliverableReviewerService, isDeliverableWriter } from "./deliverable-reviewer";

const waitForReview = () => new Promise((resolve) => setTimeout(resolve, 30));

function toolEvent(type: "tool_execution_start" | "tool_execution_end", toolName: string) {
	return type === "tool_execution_start"
		? ({ type, toolName, toolCallId: `${toolName}-1`, args: { path: "out.md" } } as never)
		: ({
				type,
				toolName,
				toolCallId: `${toolName}-1`,
				isError: false,
				result: { path: "out.md" },
			} as never);
}

describe("DeliverableReviewerService", () => {
	it("只对白名单写入工具触发，归档/下载类工具不触发", () => {
		const scheduled: unknown[] = [];
		const service = new DeliverableReviewerService({
			getCwd: () => undefined,
			onSchedule: (request) => scheduled.push(request),
			onResult: () => {},
		});

		service.observe("s1", toolEvent("tool_execution_start", "research_archive_source"));
		service.observe("s1", toolEvent("tool_execution_end", "research_archive_source"));
		service.observe("s1", toolEvent("tool_execution_start", "write"));
		service.observe("s1", toolEvent("tool_execution_end", "write"));

		expect(scheduled).toHaveLength(1);
		expect((scheduled[0] as { trigger: string }).trigger).toBe("deliverable-write");
		expect(isDeliverableWriter("research_archive_source")).toBe(false);
		expect(isDeliverableWriter("write")).toBe(true);
		service.dispose();
	});

	it("开启模型审稿时选择不同 provider，关闭时不调用模型", async () => {
		const modelReview = vi.fn(
			(
				_snapshot: DeliverableReviewSnapshot,
				_selection: ReviewerProviderSelection,
			): DeliverableReviewFinding[] => [],
		);
		const enabled = new DeliverableReviewerService({
			getCwd: () => undefined,
			getProviders: () => [{ provider: "reviewer", model: "review-model" }],
			getMainProvider: () => "main",
			useModel: () => true,
			modelReview,
			onResult: () => {},
		});
		enabled.schedule({
			sessionId: "s-enabled",
			snapshot: { body: "报告" },
			trigger: "publication-projection",
		});
		await waitForReview();
		expect(modelReview).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ provider: "reviewer", independent: true }),
		);
		enabled.dispose();

		const disabledModelReview = vi.fn(
			(
				_snapshot: DeliverableReviewSnapshot,
				_selection: ReviewerProviderSelection,
			): DeliverableReviewFinding[] => [],
		);
		const disabled = new DeliverableReviewerService({
			getCwd: () => undefined,
			getProviders: () => [{ provider: "reviewer", model: "review-model" }],
			getMainProvider: () => "main",
			useModel: () => false,
			modelReview: disabledModelReview,
			onResult: () => {},
		});
		disabled.schedule({
			sessionId: "s-disabled",
			snapshot: { body: "报告" },
			trigger: "publication-projection",
		});
		await waitForReview();
		expect(disabledModelReview).not.toHaveBeenCalled();
		disabled.dispose();
	});
});
