import { describe, expect, it } from "vitest";
import { cardField, cardLink, failureCard, flowCard, literatureCard, statusTone } from "../src/index";

describe("knowledge flow cards", () => {
	it("classifies statuses and bounds generic fields and links", () => {
		expect(statusTone("saved")).toBe("ok");
		expect(statusTone("failed")).toBe("error");
		expect(statusTone("pending")).toBe("muted");
		expect(statusTone("partial")).toBe("warn");
		expect(cardField("Status", "saved")).toMatchObject({
			label: "Status",
			value: "saved",
			status: true,
			tone: "ok",
		});
		expect(cardField("Status", "", { status: false })).toMatchObject({ value: "unknown", tone: "muted" });
		expect(cardLink("path", "/tmp/report.md", "Report")).toMatchObject({
			kind: "path",
			target: "/tmp/report.md",
		});
		expect(cardLink("unsafe", "/tmp/report.md", "Report")).toBeNull();
	});

	it("constructs bounded cards and failure cards from host observations", () => {
		const card = flowCard({
			kind: "artifact",
			title: "Report",
			status: "ready",
			fields: Array.from({ length: 14 }, (_, index) => cardField(String(index), index)),
			links: Array.from({ length: 8 }, (_, index) => cardLink("path", `/tmp/${index}`, String(index))),
		});
		expect(card).toMatchObject({ kind: "artifact", title: "Report", status: "ready", tone: "ok" });
		expect(card.fields).toHaveLength(12);
		expect(card.links).toHaveLength(6);
		expect(
			failureCard({
				toolCallId: "call-1",
				toolName: "write",
				result: { content: [{ type: "text", text: "denied" }] },
			}),
		).toMatchObject({
			key: "call-1",
			kind: "failure",
			status: "failed",
			detail: "denied",
		});
	});

	it("builds literature cards from write and read receipts", () => {
		const saved = literatureCard(
			{
				toolName: "zotero_save",
				result: {
					details: {
						doi: "10.1000/example",
						title: "Example paper",
						status: "saved",
						zoteroKey: "ABCD1234",
						fulltextStatus: "found",
						channel: "web",
						library: { name: "Research" },
					},
				},
			},
			{ write: true },
		);
		expect(saved).toMatchObject({ key: "doi:10.1000/example", title: "Example paper", status: "saved" });
		expect(saved?.links).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ target: "zotero://select/library/items/ABCD1234" }),
				expect.objectContaining({ target: "https://doi.org/10.1000/example" }),
			]),
		);
		const read = literatureCard({
			toolName: "zotero_verify",
			result: {
				details: {
					receipt: {
						doi: "10.1000/example",
						status: "both-verified",
						zoteroKey: "ABCD1234",
						zotero: {
							status: "verified",
							zoteroKey: "ABCD1234",
							title: "Example paper",
							fulltextStatus: "found",
						},
						obsidian: { status: "verified", path: "Library/Papers/example.md" },
					},
				},
			},
		});
		expect(read).toMatchObject({ status: "both-verified", path: "Library/Papers/example.md" });
		expect(literatureCard({ result: { details: {} } })).toBeNull();
	});
});
