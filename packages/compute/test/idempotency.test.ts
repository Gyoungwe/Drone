import { describe, expect, it } from "vitest";
import { externalEffectKey } from "../src/jobs/idempotency";

describe("external effect keys", () => {
	it("are stable across object key order and distinct namespaces", () => {
		expect(externalEffectKey("zotero.create", { doi: "10.1/x", collection: "C1" })).toBe(
			externalEffectKey("zotero.create", { collection: "C1", doi: "10.1/x" }),
		);
		expect(externalEffectKey("download", { doi: "10.1/x" })).not.toBe(
			externalEffectKey("knowledge.ingest", { doi: "10.1/x" }),
		);
	});
});
