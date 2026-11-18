import { createHash } from "node:crypto";
import * as wire from "@gyoungwe/plugin-api/p5-evidence";
import { Code, FileReadback, Relative, resultEnvelope } from "@gyoungwe/plugin-api/p5-receipts";
import type { P5ByteStaging } from "./p5-byte-staging";
import type { P5ByteTransaction, P5ByteWrite } from "./p5-byte-transaction";
import type {
	PluginCapabilityContext as Context,
	PluginCapabilityHandler as Handler,
} from "./runtime-capabilities";

interface Grant {
	readonly staging: P5ByteStaging;
	readonly transaction: P5ByteTransaction;
}
type GrantOf = (context: Context) => Grant | undefined;
const closed = (properties: Record<string, object>) => ({
	type: "object",
	properties,
	required: Object.keys(properties),
	additionalProperties: false,
});
const number = { type: "number" };
const version = closed({
	dev: number,
	ino: number,
	size: number,
	mtimeMs: number,
	ctimeMs: number,
	sha256: wire.StagedRef.properties.sha256,
});
const nullableVersion = { anyOf: [version, { type: "null" }] };
const writeInput = closed({ path: Relative, source: wire.StagedRef, expected: nullableVersion });
const writeResult = closed({ file: FileReadback, cleanup: { const: "complete" } });
const failure = (code: Code) => ({ status: "failed", code, receiptRef: null });
function metadata(grant: Grant, input: wire.StagedRefInput): wire.StagedRef {
	const bytes = grant.staging.read(input);
	const sha256 = createHash("sha256").update(bytes).digest("hex");
	return { fileRef: input.fileRef, bytes: bytes.length, sha256 };
}
function handler(grantOf: GrantOf) {
	return <Input>(
		inputSchema: object,
		resultSchema: object,
		approval: "always" | "own" | undefined,
		run: (grant: Grant, input: Input, context: Context) => unknown,
	): Handler => ({
		inputSchema,
		resultSchema: resultEnvelope(resultSchema),
		effect: approval ? "write" : "read",
		approval,
		approvalDetail:
			approval === "always"
				? (input) => {
						for (const value of Object.values(input as Record<string, unknown>)) Object.freeze(value);
						Object.freeze(input);
						return "application-state-write";
					}
				: undefined,
		observe: async (_input, _context, invocation) =>
			invocation.approved ? invocation.execute() : failure("DENIED"),
		execute: async (input, context) => {
			try {
				const grant = grantOf(context);
				return grant
					? { status: "ok", value: run(grant, input as Input, context) ?? null }
					: failure("SCOPE_CHANGED");
			} catch (error) {
				// Preserve public mechanism codes while stripping filesystem diagnostics and paths.
				const code =
					error instanceof Error && "code" in error
						? Code.enum.find((code) => code === error.code)
						: undefined;
				return failure(code ?? "READBACK_FAILED");
			}
		},
	});
}
/** Host grants supply roots, callers and envelope bytes; only open/write request S.
 * Composition owns disposal; failed transaction cleanup retains its lease. */
export function p5ByteCapabilityHandlers(
	grantOf: GrantOf,
	serializedBytes: (context: Context) => number,
): Record<string, Handler> {
	const make = handler(grantOf);
	return {
		"bytes.stage.open": make(wire.StagedOpenInput, wire.StagedRefInput, "always", (grant, input) =>
			grant.staging.open(input),
		),
		"bytes.stage.chunk": make(
			wire.StagedChunkInput,
			{ type: "null" },
			"own",
			(grant, input: wire.StagedChunkInput, context) => grant.staging.chunk(input, serializedBytes(context)),
		),
		"bytes.stage.seal": make(
			wire.StagedSealInput,
			wire.StagedRef,
			"own",
			(grant, input: wire.StagedSealInput) => grant.staging.seal(input),
		),
		"bytes.stage.read": make(wire.StagedRefInput, wire.StagedRef, undefined, metadata),
		"bytes.stage.cancel": make(
			wire.StagedRefInput,
			{ type: "null" },
			"own",
			(grant, input: wire.StagedRefInput) => grant.staging.cancel(input),
		),
		"bytes.inspect": make(
			closed({ path: Relative }),
			nullableVersion,
			undefined,
			(grant, input: { path: string }) => grant.transaction.inspect(input.path),
		),
		"bytes.write": make(writeInput, writeResult, "always", (grant, input: P5ByteWrite) => {
			// Preserve staging scope failures before the transaction sanitizes staging errors.
			grant.staging.read({ fileRef: input.source.fileRef });
			return grant.transaction.write(input, true);
		}),
	};
}
