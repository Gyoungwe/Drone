import { describe, expect, it } from "vitest";
import { decodeDurableDocument, makeDurableDocument } from "./durable-doc";

describe("durable documents", () => {
	const migration = {
		kind: "test.state",
		version: 2,
		migrate(value: unknown) {
			const raw = (value ?? {}) as { count?: unknown };
			return { count: typeof raw.count === "number" ? raw.count : 0 };
		},
	};

	it("round-trips the typed envelope", () => {
		const document = makeDurableDocument(migration.kind, migration.version, { count: 3 }, { scope: "test" });
		expect(decodeDurableDocument(document, migration)).toEqual({ count: 3 });
		expect(document).toMatchObject({ kind: "test.state", version: 2, scope: "test" });
	});

	it("migrates legacy and old-version values without writing them back", () => {
		expect(decodeDurableDocument({ count: 4 }, migration)).toEqual({ count: 4 });
		expect(decodeDurableDocument({ kind: "test.state", version: 1, count: 5 }, migration)).toEqual({
			count: 5,
		});
	});
});
