import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { Type } from "typebox";
import type { SessionDirectory } from "../session/registry";
import type { PluginCapabilityHandler } from "./runtime-capabilities";
import { requirePluginSession } from "./session-caller";
import { MAX_FILE_BINARY_BASE64, MAX_FILE_BINARY_BYTES, readStableFileBytes } from "./stable-file-bytes";

/**
 * Workspace reads on a plugin's behalf under the session's CURRENT read permissions: the same
 * decision (rules, boundaries, confirmation) a model `read` call gets. Both the requested path
 * and the resolved file must be allowed, so a link cannot reach past the policy.
 */
export function workspaceCapabilityHandlers(
	sessions: SessionDirectory,
	readChecks: ReadonlyMap<string, (path: string) => Promise<boolean>>,
): Record<"workspace.readFile", PluginCapabilityHandler> {
	return {
		"workspace.readFile": {
			effect: "read",
			inputSchema: Type.Object(
				{ path: Type.String({ minLength: 1, maxLength: 4096 }) },
				{ additionalProperties: false },
			),
			resultSchema: Type.Object(
				{
					path: Type.String(),
					/** Path relative to the session's canonical workspace ("/"-separated), or null outside it. */
					workspacePath: Type.Union([Type.String(), Type.Null()]),
					base64: Type.String({ maxLength: MAX_FILE_BINARY_BASE64 }),
					sha256: Type.String({ pattern: "^[a-f0-9]{64}$" }),
					bytes: Type.Integer({ minimum: 0, maximum: MAX_FILE_BINARY_BYTES }),
					version: Type.Object(
						{
							dev: Type.Number(),
							ino: Type.Number(),
							size: Type.Number(),
							mtimeMs: Type.Number(),
							ctimeMs: Type.Number(),
						},
						{ additionalProperties: false },
					),
				},
				{ additionalProperties: false },
			),
			execute: async (input, context) => {
				const entry = requirePluginSession(sessions, context);
				const allowed = readChecks.get(entry.session.sessionId);
				if (!allowed) throw new Error("This session has no active read permission policy");
				const requested = resolve(entry.cwd, (input as { path: string }).path);
				const real = await realpath(requested);
				for (const path of real === requested ? [requested] : [requested, real])
					if (!(await allowed(path))) throw new Error("Current permission policy denied this read");
				const result = await readStableFileBytes(async () => {
					if ((await realpath(requested)) !== real) throw new Error("Workspace file changed during read");
					return real;
				}, context.signal);
				const rel = relative(await realpath(entry.cwd), real);
				const inside = !!rel && !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`);
				return { path: real, workspacePath: inside ? rel.split(sep).join("/") : null, ...result };
			},
		},
	};
}
