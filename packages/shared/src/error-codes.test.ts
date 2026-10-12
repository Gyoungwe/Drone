import { describe, expect, it } from "vitest";
import { ERROR_CODES, errorCardActions, errorCodeOf } from "./error-codes";
import { buildLlmUiError, buildStreamGuardUiError } from "./errors";
import { pinTrailingErrorRow } from "./transcript/chat-rows";
import type { ChatRow } from "./transcript/chat-rows";

describe("error code table (P8)", () => {
	it("assigns codes when building errors", () => {
		expect(buildLlmUiError("401 Unauthorized").code).toBe("AUTH");
		expect(buildLlmUiError("maximum context length exceeded").code).toBe("CONTEXT_EXCEEDED");
		expect(buildLlmUiError("fetch failed").code).toBe("NETWORK");
		expect(buildLlmUiError("weird").code).toBe("TURN_FAILED");
		expect(buildStreamGuardUiError("loop").code).toBe("STREAM_GUARD");
	});
	it("CONTEXT_EXCEEDED is the only turn-level code without continue", () => {
		const noContinue = Object.entries(ERROR_CODES)
			.filter(([, s]) => s.turnLevel && !s.continuable)
			.map(([c]) => c);
		expect(noContinue).toEqual(["CONTEXT_EXCEEDED"]);
		expect(ERROR_CODES.CONTEXT_EXCEEDED.actions).not.toContain("continue");
	});
	it("derives codes for legacy cards from titleKey", () => {
		expect(errorCodeOf({ titleKey: "error.title.modelTimeout" })).toBe("MODEL_TIMEOUT");
		expect(errorCodeOf({ titleKey: "error.title.unknown" })).toBe("TURN_FAILED");
		expect(errorCodeOf({ code: "AUTH", titleKey: "x" })).toBe("AUTH");
	});
	it.each(Object.keys(ERROR_CODES))("%s has a renderable action list", (code) => {
		const actions = errorCardActions({
			code,
			severity: "error",
			source: "llm",
			titleKey: "t",
			actions: [],
			timestamp: 0,
		});
		expect(Array.isArray(actions)).toBe(true);
		expect(actions).not.toContain("copyDetail");
	});
});

describe("pinTrailingErrorRow", () => {
	const msg = (id: string, kind: "user" | "error" | "assistant"): ChatRow =>
		({ kind: "message", key: id, message: { kind, id } }) as unknown as ChatRow;
	const extra = (key: string): ChatRow => ({ kind: "streamingSubagents", key, runs: [] });
	it("moves the latest error card behind trailing auxiliary rows", () => {
		const rows = [msg("u", "user"), msg("e", "error"), extra("x"), extra("y")];
		expect(pinTrailingErrorRow(rows).map((r) => r.key)).toEqual(["u", "x", "y", "e"]);
	});
	it("leaves errors in place once a later message exists", () => {
		const rows = [msg("e", "error"), msg("u2", "user"), extra("x")];
		expect(pinTrailingErrorRow(rows)).toBe(rows);
	});
});
