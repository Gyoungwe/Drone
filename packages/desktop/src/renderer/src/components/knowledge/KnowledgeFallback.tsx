import type { KnowledgeBinding } from "@drone/shared";
import { useEffect, useState } from "react";
import { getPi } from "../../api";
import { useT } from "../../i18n";
import { reportKnowledgeError } from "../../lib/knowledge-error";
import { useKnowledgeStore } from "../../stores/knowledge";
import { useSessionsStore } from "../../stores/sessions";
import { useSettingsStore } from "../../stores/settings";
import { Button } from "../ui/Button";

export function KnowledgeFallback() {
	const t = useT();
	const cwd = useSessionsStore((s) => s.cwd);
	const dialog = useKnowledgeStore((s) => s.dialog);
	const revision = useKnowledgeStore((s) => s.revision);
	const currentCwd = dialog?.cwd ?? cwd;
	const [binding, setBinding] = useState<KnowledgeBinding | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Host invalidation events refresh the persisted binding.
	useEffect(() => {
		let live = true;
		setBinding(null);
		setError(null);
		setLoading(true);
		void getPi()
			.getKnowledgeOverview({ cwd: currentCwd, sessionId: null })
			.then(
				(value) => {
					if (live) setBinding(value.binding ?? null);
				},
				(failure) => {
					if (live) setError(failure instanceof Error ? failure.message : String(failure));
				},
			)
			.finally(() => {
				if (live) setLoading(false);
			});
		return () => {
			live = false;
		};
	}, [currentCwd, revision]);
	return (
		<section
			className="p-6"
			data-testid="knowledge-default-fallback"
			aria-label={t("knowledgeFallback.title")}
		>
			<h2 className="text-lg font-semibold">{t("knowledgeFallback.title")}</h2>
			<p className="mt-2 text-sm text-ink-dim">{t("knowledgeFallback.hint")}</p>
			{error ? (
				<p role="alert" className="mt-3 text-sm text-err">
					{error}
				</p>
			) : (
				<p role="status" className="mt-3 break-all text-sm">
					{loading
						? t("knowledgeFallback.loading")
						: binding
							? binding.vault
							: t("knowledgeFallback.unbound")}
				</p>
			)}
			<div className="mt-4 flex flex-wrap gap-2">
				<Button
					disabled={!binding}
					onClick={() => {
						if (binding)
							void getPi()
								.openKnowledgeTarget({ cwd: currentCwd, revision: binding.revision })
								.catch(reportKnowledgeError);
					}}
				>
					{t("knowledgeFallback.openFolder")}
				</Button>
				<Button onClick={() => useSettingsStore.getState().openWith("uiPlugins")}>
					{t("knowledgeFallback.managePlugins")}
				</Button>
			</div>
		</section>
	);
}
