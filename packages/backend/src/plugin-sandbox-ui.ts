import { type Static, Type } from "typebox";
import type { ExtensionContext } from "./session-engine/sdk";

export type PluginSandboxUiContext = Pick<ExtensionContext, "hasUI" | "ui">;
const identity = { type: Type.Literal("ui_request"), id: Type.String(), requestId: Type.String() };
const dialog = { ...identity, title: Type.String(), timeout: Type.Optional(Type.Number({ minimum: 0 })) };
export const sandboxUiMessageSchema = Type.Union([
	Type.Object({ ...dialog, method: Type.Literal("confirm"), message: Type.String() }),
	Type.Object({ ...dialog, method: Type.Literal("select"), options: Type.Array(Type.String()) }),
	Type.Object({ ...dialog, method: Type.Literal("input"), placeholder: Type.Optional(Type.String()) }),
	Type.Object({ type: Type.Literal("ui_cancel"), id: Type.String(), requestId: Type.String() }),
	Type.Object({
		type: Type.Literal("ui_notify"),
		id: Type.String(),
		message: Type.String(),
		severity: Type.Optional(
			Type.Union([Type.Literal("info"), Type.Literal("warning"), Type.Literal("error")]),
		),
	}),
]);
export type SandboxUiMessage = Static<typeof sandboxUiMessageSchema>;

/** Dialog implementations may outlive their session; stop retaining their invocation on abort. */
export async function awaitSandboxDialog<T>(show: () => Promise<T>, signal: AbortSignal): Promise<T> {
	signal.throwIfAborted();
	let abort!: () => void;
	const canceled = new Promise<never>((_resolve, reject) => {
		abort = () => reject(signal.reason);
		signal.addEventListener("abort", abort, { once: true });
	});
	try {
		return await Promise.race([show(), canceled]);
	} finally {
		signal.removeEventListener("abort", abort);
	}
}
