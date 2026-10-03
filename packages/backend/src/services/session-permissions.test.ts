import { describe, expect, it } from "vitest";
import { SessionPermissionService } from "./session-permissions";

describe("SessionPermissionService", () => {
	it("keeps modes scoped to live sessions and defaults unknown ids safely", () => {
		const service = new SessionPermissionService();
		expect(service.getMode("missing")).toBe("default");
		const mode = service.createMode();
		service.bind("session-1", mode);
		expect(service.getMode("session-1")).toBe("default");

		service.setMode("session-1", "fullAccess");
		expect(mode.current).toBe("fullAccess");
		expect(service.getMode("session-1")).toBe("fullAccess");
		service.remove("session-1");
		expect(service.getMode("session-1")).toBe("default");
	});

	it("rejects mode changes for sessions that are not bound", () => {
		const service = new SessionPermissionService();
		expect(() => service.setMode("missing", "fullAccess")).toThrow("Session not found: missing");
	});

	it("disposes all session modes", () => {
		const service = new SessionPermissionService();
		service.bind("session-1", service.createMode());
		service.bind("session-2", service.createMode());
		service.dispose();
		expect(service.getMode("session-1")).toBe("default");
		expect(service.getMode("session-2")).toBe("default");
	});
});
