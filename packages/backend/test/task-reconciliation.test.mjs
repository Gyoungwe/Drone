import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { createTaskWorkbench, inspectTaskFile, WORKBENCH_ENTRY } from "../../../.pi/lib/tasks/workbench.mjs";
import { createZoteroReconciler } from "../../../.pi/lib/tasks/zotero-reconcile.mjs";

vi.setConfig({ testTimeout: 30000 });
function pdf(text) {
	const stream = `BT /F1 12 Tf 50 750 Td (${text.replace(/[()\\]/g, "\\$&")}) Tj ET`;
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
		`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
	];
	let output = "%PDF-1.4\n",
		offsets = [0];
	for (let i = 0; i < objects.length; i++) {
		offsets.push(Buffer.byteLength(output));
		output += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
	}
	const start = Buffer.byteLength(output);
	output += `xref\n0 6\n0000000000 65535 f \n${offsets
		.slice(1)
		.map((o) => String(o).padStart(10, "0") + " 00000 n ")
		.join("\n")}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
	return output;
}
it("actual isolated PDF parser checks requested title and DOI, not extension alone", async () => {
	const dir = await mkdtemp(join(tmpdir(), "drone-pdf-identity-"));
	try {
		await writeFile(join(dir, "paper.pdf"), pdf("An isolated developmental study DOI 10.1234/fixture"));
		const expected = { kind: "pdf", title: "An isolated developmental study", doi: "10.1234/fixture" };
		const result = await inspectTaskFile(dir, "paper.pdf", expected);
		expect(result.identity).toBe("metadata-matched");
		expect(result.extraction.pages).toBe(1);
		await expect(inspectTaskFile(dir, "paper.pdf", { ...expected, doi: "10.1234/wrong" })).rejects.toThrow(
			"does not match",
		);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
it("native write timeout reconciles existing expected bytes without replay", async () => {
	const dir = await mkdtemp(join(tmpdir(), "drone-task-timeout-"));
	try {
		const entries = [],
			j = createTaskWorkbench({ persist: (data) => entries.push({ customType: WORKBENCH_ENTRY, data }) });
		j.attach("s");
		j.openTask("produce data");
		j.guard({ toolName: "write", toolCallId: "w", input: { path: "out.csv", content: "value\n1" } });
		await writeFile(join(dir, "out.csv"), "value\n1");
		const recovered = createTaskWorkbench();
		recovered.attach("s", entries);
		await recovered.reconcile(dir);
		expect(recovered.snapshot().operations[0].state).toBe("verified");
		expect(
			recovered.guard({
				toolName: "write",
				toolCallId: "retry",
				input: { path: "out.csv", content: "value\n1" },
			}),
		).toMatchObject({ block: true });
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
it("changing task IDs cannot replay another task's unknown side effect", () => {
	const j = createTaskWorkbench();
	j.attach("s");
	j.openTask("A");
	const event = { toolName: "bash", toolCallId: "a", input: { command: "import items" } };
	j.guard(event);
	j.pause("interrupted");
	j.openTask("B");
	expect(j.guard({ ...event, toolCallId: "b" })).toMatchObject({ block: true });
});
it("Zotero lookup is exact, read-only and distinguishes attachment metadata from contents", async () => {
	const request = vi.fn(async (path) =>
		path.startsWith("items?")
			? { data: [{ key: "ABCD1234", data: { DOI: "10.1234/fixture", collections: ["COLL1234"] } }], total: 1 }
			: {
					data: [
						{
							key: "FILE1234",
							data: { parentItem: "ABCD1234", itemType: "attachment", contentType: "application/pdf" },
						},
					],
					total: 1,
				},
	);
	const reconcile = createZoteroReconciler({ libraryId: "123", request });
	const result = await reconcile({
		libraryId: "123",
		doi: "https://doi.org/10.1234/fixture",
		collection: "COLL1234",
	});
	expect(result).toMatchObject({
		state: "found",
		itemId: "ABCD1234",
		attachmentContentsVerified: false,
		scientificallyVerified: false,
		safeToAutoRetry: false,
	});
	expect(request).toHaveBeenCalledTimes(2);
	expect(request.mock.calls.every(([p]) => p.startsWith("items"))).toBe(true);
});
it.each([0, 2, 101])("Zotero count %s never becomes verified import completion", async (count) => {
	const reconcile = createZoteroReconciler({
		libraryId: "123",
		request: async () => ({
			data: Array.from({ length: Math.min(count, 2) }, () => ({
				key: "ABCD1234",
				data: { DOI: "10.1234/fixture" },
			})),
			total: count,
		}),
	});
	expect((await reconcile({ doi: "10.1234/fixture" })).state).toBe(
		count === 0 ? "not-found" : count === 2 ? "ambiguous" : "unknown",
	);
});
it("foreign library and unavailable credentials never trigger a lookup", async () => {
	const request = vi.fn();
	const reconcile = createZoteroReconciler({ libraryId: "123", request });
	expect((await reconcile({ libraryId: "999", doi: "10.1234/x" })).state).toBe("blocked");
	expect(request).not.toHaveBeenCalled();
});
