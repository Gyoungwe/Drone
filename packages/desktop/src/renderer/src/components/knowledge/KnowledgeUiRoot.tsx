import { useEffect } from "react";
import { getPi } from "../../api";
import { useKnowledgeStore } from "../../stores/knowledge";
import { useSessionsStore } from "../../stores/sessions";

/** Host event bridge; product overlays are owned by app.overlay contributions. */
export function KnowledgeUiRoot() {
	useEffect(() => {
		let timer: ReturnType<typeof setTimeout> | null = null;
		const unsubscribe = getPi().onKnowledgeEvent((event) => {
			const store = useKnowledgeStore.getState();
			if (event.kind === "invalidate") {
				if (timer) clearTimeout(timer);
				timer = setTimeout(() => {
					timer = null;
					store.invalidate();
				}, 250);
				return;
			}
			if (event.kind === "open-review") {
				const sessions = useSessionsStore.getState();
				const source = sessions.sessions.find((s) => s.sessionId === event.sessionId);
				const cwd = source?.cwd || sessions.cwd;
				if (cwd)
					store.openReview({
						cwd,
						sessionId: event.sessionId,
						id: event.id || "",
					});
				return;
			}
			store.apply(event);
		});
		return () => {
			unsubscribe();
			if (timer) clearTimeout(timer);
		};
	}, []);
	return null;
}
