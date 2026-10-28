import type { AskQuestionRoute } from "../session/ask-gate";
import type { RegisteredSession } from "../session/registry";
import type { ExtensionUIContext } from "./sdk";

/** Invoke the actual live SDK UI binding; never manufacture an SDK context. */
export async function withSessionQuestion<T>(
	entry: RegisteredSession,
	callSignal: AbortSignal,
	route: AskQuestionRoute | undefined,
	execute: (ui: Pick<ExtensionUIContext, "select" | "input">, signal: AbortSignal) => Promise<T>,
): Promise<T> {
	const runner = entry.session.extensionRunner;
	if (!runner || !route || !entry.questionGate) throw new Error("Session question UI is unavailable");
	const context = runner.createContext();
	if (!context.hasUI) throw new Error("Session question UI is unavailable");
	const sdkSignal = context.signal;
	const signal = sdkSignal ? AbortSignal.any([callSignal, sdkSignal]) : callSignal;
	signal.throwIfAborted();
	const result = await entry.questionGate.withRoute(route, () => execute(context.ui, signal));
	signal.throwIfAborted();
	if (entry.session.extensionRunner !== runner) throw new Error("Session question SDK context was reloaded");
	return result;
}
