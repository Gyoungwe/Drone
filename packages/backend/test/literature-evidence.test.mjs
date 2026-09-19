import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
	exactDoiItems,
	normalizeDoi,
	verifyLiteratureReceipt,
} from "../../../.pi/lib/literature-receipt.mjs";
import {
	deliveryContract,
	hasPaperCitation,
	requiresPaperEvidence,
} from "../../../.pi/lib/source-delivery.mjs";

it("activates for Chinese comparative-genomics planning without download words", () => {
	expect(requiresPaperEvidence("帮我构思一下昆虫翅发育基因的比较基因组分析方式和流程")).toBe(true);
	expect(deliveryContract("证据有具体的文献支持，文献入库到zotero和obsidian").guidance).toContain(
		"research_verify_literature",
	);
	expect(deliveryContract("你好")).toBeNull();
});
it("requires a scientist-facing conclusion before operational follow-up", () => {
	const guidance = deliveryContract("帮我构思一下昆虫翅发育基因的比较基因组分析方式和流程").guidance;
	expect(guidance).toContain("Start the visible answer with the scientific conclusion");
	expect(guidance).toContain("one default recommendation");
	expect(guidance).toContain("Do not expose internal workflow terms");
	expect(guidance).toContain("claims binding");
	expect(guidance).toContain("what the current evidence supports");
});
it("keeps the research delivery contract for a topic continuation", () => {
	const result = deliveryContract("继续", { researchContinuation: true });
	expect(result.kind).toBe("research");
	expect(result.guidance).toContain("Start the visible answer with the scientific conclusion");
});
it("does not turn read-only research or ordinary planning into an explainer-write task", () => {
	for (const prompt of ["只读复测昆虫翅发育论文，不要入库", "昆虫翅发育比较基因组分析方式和流程"]) {
		const result = deliveryContract(prompt, { showMeAvailable: true });
		expect(result.guidance).toContain("No explainer artifact is requested");
		expect(result.guidance).not.toContain("after creating it, archive it");
	}
	expect(deliveryContract("图解这篇论文", { showMeAvailable: true }).guidance).toContain(
		"after creating it, archive it",
	);
});
it("normalizes identity but rejects unrelated CLI fallback hits", () => {
	expect(normalizeDoi("https://doi.org/10.1038/ABC")).toBe("10.1038/abc");
	expect(
		exactDoiItems([{ doi: "10.1038/xyz" }, { data: { DOI: "10.1038/ABC" } }], "doi:10.1038/abc"),
	).toHaveLength(1);
	expect(exactDoiItems([{ doi: "10.1038/abc" }], "bad")).toEqual([]);
});
it("Wiki alone is not a paper citation", () => {
	expect(hasPaperCitation([{ path: "Wiki/wing.md" }])).toBe(false);
	expect(hasPaperCitation([{ path: "Library/Papers/wing.md" }])).toBe(false);
	expect(hasPaperCitation([{ path: "Library/Papers/wing.md", paperDois: ["10.1038/abc"] }])).toBe(true);
});
it("verifies both destinations without claiming fulltext or science", async () => {
	const vault = await mkdtemp(join(tmpdir(), "literature-"));
	try {
		await mkdir(join(vault, "Library/Papers"), { recursive: true });
		await writeFile(
			join(vault, "Library/Papers/a.md"),
			"doi:10.1038/abc\n- [Zotero](zotero://select/library/items/ABCDEFGH)",
		);
		const fetcher = async (url) => ({
			ok: true,
			json: async () => (url.endsWith("children") ? [] : { data: { DOI: "10.1038/abc", title: "Paper" } }),
		});
		const args = {
			vault,
			doi: "10.1038/ABC",
			zotero_key: "ABCDEFGH",
			note_path: "Library/Papers/a.md",
			fetcher,
		};
		const result = await verifyLiteratureReceipt(args);
		expect(result.status).toBe("both-verified");
		expect(result.scientificallyVerified).toBe(false);
		expect(result.zotero.fulltextStatus).toBe("metadata-only");
		expect(
			(await verifyLiteratureReceipt({ ...args, note_path: "Library/Papers/../../secret.md" })).status,
		).toBe("partial");
		const failed = await verifyLiteratureReceipt({
			...args,
			fetcher: async () => {
				throw new Error("offline");
			},
		});
		expect(failed.zotero.status).toBe("unavailable");
		expect(failed.obsidian.status).toBe("verified");
		const mismatch = await verifyLiteratureReceipt({
			...args,
			fetcher: async () => ({ ok: true, json: async () => ({ data: { DOI: "10.1038/other" } }) }),
		});
		expect(mismatch.zotero.status).toBe("identity-mismatch");
	} finally {
		await rm(vault, { recursive: true, force: true });
	}
});
