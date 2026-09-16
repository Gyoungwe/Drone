import type { KnowledgeNote } from "@drone/shared";
import { legacyEvidenceNotice } from "@drone/shared";
import { useEffect, useState } from "react";
import { getPi } from "../../api";
import { Markdown } from "../chat/Markdown";
import { Button } from "../ui/Button";
import { useKnowledgeText } from "./copy";
export function KnowledgeNoteViewer({
	cwd,
	revision,
	path,
	onClose,
}: {
	cwd: string | null;
	revision: number;
	path: string;
	onClose: () => void;
}) {
	const t = useKnowledgeText();
	const [line, setLine] = useState(1),
		[note, setNote] = useState<KnowledgeNote | null>(null),
		[error, setError] = useState<string | null>(null),
		[loading, setLoading] = useState(false);
	useEffect(() => setLine(1), []);
	useEffect(() => {
		let live = true;
		setLoading(true);
		setNote(null);
		setError(null);
		void getPi()
			.readKnowledgeNote({ cwd, path, startLine: line, revision })
			.then(
				(value) => {
					if (live) setNote(value);
				},
				(e) => {
					if (live) setError(String(e.message || e));
				},
			)
			.finally(() => {
				if (live) setLoading(false);
			});
		return () => {
			live = false;
		};
	}, [cwd, path, line, revision]);
	return (
		<section
			className="rounded-xl border border-border bg-surface p-3"
			aria-label={t("viewNote")}
			data-testid="knowledge-note"
		>
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0">
					<h4 className="text-xs font-semibold">{t("viewNote")}</h4>
					<p className="mt-1 break-all font-mono text-[11px] text-ink-dim">{path}</p>
				</div>
				<Button size="sm" onClick={onClose} aria-label={t("close")}>
					×
				</Button>
			</div>
			<p className="my-2 text-[11px] text-ink-dim">{t("uiRead")}</p>
			{loading && (
				<p role="status" className="text-xs">
					{t("loading")}
				</p>
			)}
			{error && (
				<p role="alert" className="whitespace-pre-wrap break-words text-xs text-err">
					{error}
				</p>
			)}
			{note?.missing && <p className="text-xs text-warn">{t("missing")}</p>}
			{note?.text && (
				<>
					<p className="mb-1 font-mono text-[10px] text-ink-faint">
						L{note.startLine}–{note.endLine} · {note.hash?.slice(0, 12)}{" "}
						{note.truncated ? ` · ${t("truncated")}` : ""}
					</p>
					<div className="max-h-80 overflow-auto rounded-lg bg-hover p-3">
						{legacyEvidenceNotice(note.text) && (
							<p
								data-testid="legacy-evidence-status"
								className="mb-2 rounded border border-border p-2 text-xs text-warn"
							>
								{legacyEvidenceNotice(note.text)}
							</p>
						)}
						<Markdown text={note.displayText || note.text} />
					</div>
				</>
			)}
			{note?.displayLinkBase && (
				<p className="my-2 break-words text-[10px] text-ink-faint">
					{t("linkPreviewOnly")} {note.displayLinkBase}
				</p>
			)}
			{note?.humanReview?.text && (
				<details className="mt-2 text-xs">
					<summary className="cursor-pointer font-medium">{t("humanReview")}</summary>
					<pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap break-words text-ink-2">
						{note.humanReview.text}
					</pre>
				</details>
			)}
			<div className="mt-2 flex flex-wrap gap-1">
				{line > 1 && (
					<Button size="sm" onClick={() => setLine(1)}>
						{t("readBack")}
					</Button>
				)}
				{note?.truncated && note.endLine < (note.totalLines || 0) && note.endLine >= line && (
					<Button size="sm" onClick={() => setLine(note.endLine + 1)}>
						{t("readMore")}
					</Button>
				)}
				<Button
					size="sm"
					disabled={loading || note?.missing}
					onClick={() =>
						void getPi()
							.openKnowledgeTarget({ cwd, path, revision })
							.catch((e) => setError(String(e.message || e)))
					}
				>
					{t("openObsidian")}
				</Button>
			</div>
		</section>
	);
}
