import { describe, expect, it, vi } from "vitest";

vi.mock("../../api", () => ({ getPi: () => ({}) }));
vi.mock("../../i18n", () => ({ useI18nStore: () => "zh", useT: () => (key: string) => key }));

import { isZoteroLocalWriteStatus, localWriteStateKey } from "./ZoteroLocalWriteSection";

const base = {
	reachable: true,
	supported: true,
	authorized: false,
	source: null,
	staleServer: false,
} as const;

describe("zotero local write section", () => {
	it("explains each state before offering authorization", () => {
		expect(localWriteStateKey({ ...base, reachable: false, supported: null })).toBe("localUnreachable");
		expect(localWriteStateKey({ ...base, supported: false })).toBe("localUnsupported");
		expect(localWriteStateKey({ ...base, source: "settings", staleServer: true })).toBe("localStale");
		expect(localWriteStateKey(base)).toBe("localNotAuthorized");
		expect(localWriteStateKey({ ...base, authorized: true, source: "settings" })).toBe("localAuthorized");
		expect(localWriteStateKey({ ...base, authorized: true, source: "env" })).toBe("localFromEnv");
	});

	it("does not treat a contract error envelope as a status", () => {
		expect(isZoteroLocalWriteStatus({ code: "invalid_result" })).toBe(false);
		expect(isZoteroLocalWriteStatus(base)).toBe(true);
	});
});
