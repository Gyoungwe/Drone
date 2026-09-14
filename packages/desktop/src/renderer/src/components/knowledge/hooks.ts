import type { KnowledgeOverview } from "@percho/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { getPi } from "../../api";
import { useKnowledgeStore } from "../../stores/knowledge";
import { isDraftSessionId, useSessionsStore } from "../../stores/sessions";
import { useSettingsStore } from "../../stores/settings";
import { pushToast } from "../../stores/toasts";
import { useUiStore } from "../../stores/ui";

function errText(error: unknown): string {
	const raw = error instanceof Error ? error.message : String(error);
	return raw.replace(/^Error invoking remote method '[^']+': Error:\s*/i, "").split("\n")[0] ?? raw;
}

export function useKnowledgeOverview(cwd: string | null, sessionId: string | null = null) {
	const revision = useKnowledgeStore((s) => s.revision),
		epoch = useRef(0);
	const [data, setData] = useState<KnowledgeOverview | null>(null),
		[error, setError] = useState<string | null>(null),
		[loading, setLoading] = useState(false);
	const refresh = useCallback(async () => {
		const seq = ++epoch.current;
		setLoading(true);
		setError(null);
		try {
			const result = await getPi().getKnowledgeOverview({
				cwd,
				sessionId: isDraftSessionId(sessionId) ? null : sessionId,
			});
			if (seq === epoch.current) setData(result);
		} catch (e) {
			if (seq === epoch.current) setError(e instanceof Error ? e.message : String(e));
		} finally {
			if (seq === epoch.current) setLoading(false);
		}
	}, [cwd, sessionId]);
	useEffect(() => {
		setData(null);
		void refresh();
		return () => {
			epoch.current++;
		};
	}, [refresh]);
	useEffect(() => {
		if (revision) void refresh();
	}, [revision, refresh]);
	// Only mounted/visible panels with unfinished indexing are polled. No model call or scan.
	useEffect(() => {
		if (
			document.hidden ||
			!data?.index ||
			(!["indexing", "partial"].includes(data.index.coverage) && !data.index.pendingChanges)
		)
			return;
		const id = window.setTimeout(() => void refresh(), 2000);
		return () => window.clearTimeout(id);
	}, [data, refresh]);
	return { data, error, loading, refresh };
}
export async function launchKnowledgeSetup(
	cwd: string | null,
	sessionId: string | null,
	path?: string,
	options?: { includeLiterature?: boolean },
) {
	if (!cwd) throw new Error("Select a workspace before setup");
	let id = sessionId;
	if (!id || isDraftSessionId(id)) {
		await useSessionsStore.getState().createSession(cwd, id ?? undefined);
		id = useSessionsStore.getState().activeSessionId;
	}
	if (!id || isDraftSessionId(id)) throw new Error("Could not create the setup session");
	try {
		// Keep settings open until the slash command is accepted so confirm dialogs
		// and failures stay visible instead of dumping the user into a blank chat.
		await getPi().startKnowledgeSetup({
			sessionId: id,
			...(path ? { path } : {}),
			...(options?.includeLiterature ? { includeLiterature: true } : {}),
		});
		useSettingsStore.getState().setOpen(false);
		useUiStore.getState().setView("chat");
		useKnowledgeStore.getState().close();
	} catch (error) {
		pushToast("error", "toast.knowledgeSetupFailed", errText(error));
		throw error;
	}
}
export async function launchZoteroSetup(cwd: string | null, sessionId: string | null) {
	if (!cwd) throw new Error("Select a workspace before setup");
	let id = sessionId;
	if (!id || isDraftSessionId(id)) {
		await useSessionsStore.getState().createSession(cwd, id ?? undefined);
		id = useSessionsStore.getState().activeSessionId;
	}
	if (!id || isDraftSessionId(id)) throw new Error("Could not create the setup session");
	try {
		await getPi().prompt(id, "/zotero-setup");
		useSettingsStore.getState().setOpen(false);
		useUiStore.getState().setView("chat");
		useKnowledgeStore.getState().close();
	} catch (error) {
		pushToast("error", "toast.knowledgeSetupFailed", errText(error));
		throw error;
	}
}
export function reportKnowledgeError(error: unknown) {
	const text = errText(error);
	pushToast("error", "toast.knowledgeSetupFailed", text);
	useKnowledgeStore.getState().apply({
		kind: "notice",
		id: String(Date.now()),
		sessionId: null,
		severity: "error",
		text,
	});
}
