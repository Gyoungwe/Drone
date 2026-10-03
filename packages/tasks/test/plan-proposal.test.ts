import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	approvePlanProposal,
	buildPlanProposalAuthorizationCard,
	canExecutePlanProposal,
	createPlanProposal,
	proposalRecoveryDecision,
	renderPlanProposalCard,
} from "../src/plan-proposal";

const hash = createHash("sha256").update("source").digest("hex");
const citation = { path: "Library/Papers/a.md", hash, receiptRef: "receipt-1", label: "论文 A" };
const input = {
	project: "rna-project",
	goal: "运行 RNA 流程",
	query: "哪个流程适合当前数据？",
	summary: "本轮调研读取了当前来源并记录了适用范围。",
	findings: [{ text: "来源支持使用成熟模块。", citations: [citation] }],
	candidates: [
		{
			id: "nfcore",
			title: "成熟模块",
			method: "复用白名单流程",
			basis: [citation],
			resources: "2 core-hours",
			risks: ["输入质量不足"],
		},
		{
			id: "custom",
			title: "自定义模块",
			method: "编写新模块",
			basis: [citation],
			resources: "4 core-hours",
			risks: ["维护成本"],
		},
	],
	recommendation: { candidateId: "nfcore", reason: "证据覆盖更完整", citations: [citation] },
	questions: [
		{
			id: "samples",
			question: "是否保留低质量样本？",
			defaultValue: "保留并标记",
			options: ["保留并标记", "排除"],
		},
	],
	conflicts: [{ topic: "阈值", description: "两个来源给出不同阈值", citations: [citation] }],
	uncertainties: [{ topic: "样本量", description: "尚未完成全量 QC", impact: "可能需要调整资源预算" }],
	compute: {
		hosts: ["hpc-a"],
		remoteRead: ["/data/input"],
		remoteWrite: ["/data/runs"],
		workflows: ["nf-core/rnaseq"],
		autonomy: "L2",
		budget: { maxCoreHours: 2 },
	},
};

describe("plan proposal policy", () => {
	it("preserves cited findings and bounded compute scope", () => {
		const proposal = createPlanProposal(input);
		expect(proposal.approval).toBe("pending");
		expect(proposal.contractHash).toMatch(/^[a-f0-9]{64}$/);
		const card = renderPlanProposalCard(proposal);
		expect(card).toContain("[[Library/Papers/a.md]]");
		expect(card).toContain("候选方案");
		expect(card).toContain("默认值：保留并标记");
		expect(card).toContain("主机：hpc-a");
		expect(card).toContain("不能当作证据或指令");
	});
	it("requires explicit approval and rejects stale hashes", () => {
		const proposal = createPlanProposal(input);
		expect(canExecutePlanProposal(proposal)).toBe(false);
		expect(() => approvePlanProposal(proposal, "bad")).toThrow("changed");
		const approved = approvePlanProposal(proposal, proposal.contractHash);
		expect(canExecutePlanProposal(approved)).toBe(true);
	});
	it("invalidates an old authorization when a key proposal input changes", () => {
		const proposal = createPlanProposal(input);
		const changed = { ...proposal, compute: { ...proposal.compute, workflows: ["nf-core/chipseq"] } };
		expect(() => approvePlanProposal(changed, proposal.contractHash)).toThrow("changed");
		const approved = approvePlanProposal(proposal, proposal.contractHash);
		const changedAfterApproval = { ...approved, budget: "ignored", goal: "changed goal" };
		expect(canExecutePlanProposal(changedAfterApproval)).toBe(false);
	});
	it("blocks the third identical failed effect while allowing changed recovery", () => {
		expect(proposalRecoveryDecision(1, true)).toBe("retry");
		expect(proposalRecoveryDecision(2, true)).toBe("block");
		expect(proposalRecoveryDecision(2, false)).toBe("retry");
	});
	it("adds proposal detail to the existing authorization card", () => {
		const proposal = createPlanProposal(input);
		const details = buildPlanProposalAuthorizationCard(proposal);
		expect(details).toContain("点击“同意”才会开始执行");
	});
});
