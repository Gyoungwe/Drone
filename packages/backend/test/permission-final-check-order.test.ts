import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";
import { makePermissionGateExtensions, placeFinalPermissionCheckLast } from "../src/permissions/extension";
import { buildSessionExtensionFactories } from "../src/session-engine/extensions";

const named = (name: string) => ({ name, factory: () => undefined }) as InlineExtension;
const names = (list: InlineExtension[]) => list.map((extension) => (extension as { name?: string }).name);

it("keeps the permission re-check after every extension appended by the loader", () => {
	const { gate, finalCheck } = makePermissionGateExtensions("/tmp/drone-agent");
	const ordered = placeFinalPermissionCheckLast([gate, finalCheck, named("capability"), named("sandboxed")]);
	expect(names(ordered)).toEqual(["permission-gate", "capability", "sandboxed", "permission-final-check"]);
	// Only the instance created with the gate is moved; a look-alike name is not trusted.
	expect(names(placeFinalPermissionCheckLast([named("permission-final-check"), named("x")]))).toEqual([
		"permission-final-check",
		"x",
	]);
});

it("ends the session extension list with the re-check of its own gate", () => {
	const list = buildSessionExtensionFactories(
		{
			runtime: { knowledge: {} },
			traces: { recordCustom: () => undefined },
			webFetch: false,
			subagentPreferBuiltin: false,
			getModelRuntime: async () => ({}),
			getSubagentModel: async () => undefined,
			onEvent: () => undefined,
			setMcpStatus: () => undefined,
		} as never,
		"/tmp/drone",
		undefined,
	);
	const listed = names(list);
	expect(listed).toContain("permission-gate");
	expect(listed.at(-1)).toBe("permission-final-check");
});

it("refuses a call the gate did not evaluate", async () => {
	const { finalCheck } = makePermissionGateExtensions("/tmp/drone-agent");
	let handler: ((event: unknown, ctx: unknown) => Promise<unknown>) | undefined;
	await finalCheck.factory({
		on: (_name: string, fn: typeof handler) => {
			handler = fn;
		},
	} as never);
	await expect(
		handler?.({ type: "tool_call", toolName: "write", toolCallId: "never-gated", input: { path: "/x" } }, {}),
	).resolves.toMatchObject({ block: true });
});
