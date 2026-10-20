import { describe, expect, it, vi } from "vitest";

vi.mock("../../api", () => ({ getPi: () => ({}) }));
vi.mock("../../i18n", () => ({
	useI18nStore: (selector: (s: { language: "zh" | "en" }) => unknown) => selector({ language: "zh" }),
}));

import { isZoteroWebApiStatus } from "./ZoteroWebApiSection";
import { formatZoteroText } from "./zotero-copy";

describe("Zotero Web API settings result", () => {
	it("interpolates the version label before rendering the status line", () => {
		expect(formatZoteroText("版本 {version}", { version: "10.0.6" })).toBe("版本 10.0.6");
		expect(formatZoteroText("Version {version}", { version: "10.0.6" })).not.toContain("{version}");
	});

	it("accepts a status and rejects the host contract's validation envelope", () => {
		expect(
			isZoteroWebApiStatus({
				configured: false,
				source: null,
				libraryType: "users",
				libraryId: null,
				username: null,
				write: null,
				keyHint: null,
			}),
		).toBe(true);
		// bindContract resolves (does not reject) when arguments fail the schema, e.g. a 21-digit group ID
		expect(
			isZoteroWebApiStatus({
				code: "invalid_arguments",
				severity: "error",
				source: "app",
				titleKey: "error.title.invalidArguments",
				detail: "Invalid arguments for host method zotero:webApiSave",
				actions: ["copyDetail"],
				timestamp: 1,
			}),
		).toBe(false);
		expect(isZoteroWebApiStatus(null)).toBe(false);
	});
});
