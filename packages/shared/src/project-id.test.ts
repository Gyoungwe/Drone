import { describe, expect, it } from "vitest";
import { normalizeProjectId } from "./project-id";

describe("normalizeProjectId", () => {
	it("normalizes separators, dot segments and trailing slashes", () => {
		expect(normalizeProjectId("/work/./drone//project/", "posix")).toBe("/work/drone/project");
		expect(normalizeProjectId("C:\\Work\\Drone\\", "win32")).toBe("c:/work/drone");
	});

	it("uses case-insensitive identity on macOS and Windows", () => {
		expect(normalizeProjectId("/Users/Example/Drone", "darwin")).toBe("/users/example/drone");
		expect(normalizeProjectId("/Users/Example/Drone", "posix")).toBe("/Users/Example/Drone");
	});
});
