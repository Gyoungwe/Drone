import type { KnowledgeLiteratureRow } from "@drone/shared";
import { useState } from "react";
import { getPi } from "../../api";
import { type MessageKey, useT } from "../../i18n";
import { useKnowledgeStore } from "../../stores/knowledge";
import { useSessionsStore } from "../../stores/sessions";
import { reportKnowledgeError } from "../knowledge/hooks";
import { KnowledgeNoteViewer } from "../knowledge/KnowledgeNoteViewer";
import { Button } from "../ui/Button";
import { literatureTone } from "./literature-status";

const ZOTERO_KEY = /^[A-Z0-9]{8}$/;
const STATUS_KEYS: Record<string, MessageKey> = {
	verified: "panel.lit.verified",
	unverified: "panel.lit.unverified",
	"identity-mismatch": "panel.lit.identityMismatch",
	missing: "panel.lit.missing",
	failed: "panel.lit.failed",
	ambiguous: "panel.lit.ambiguous",
	blocked: "panel.lit.blocked",
	cancelled: "panel.lit.cancelled",
	unavailable: "panel.lit.unavailable",
	unknown: "panel.lit.unknown",
	"metadata-only": "panel.lit.metadataOnly",
	"attachment-indexed-not-read": "panel.lit.attachmentIndexed",
	saved: "panel.lit.saved",
	reused: "panel.lit.reused",
	"both-verified": "panel.lit.bothVerified",
	partial: "panel.lit.partial",
};
const CHANNEL_KEYS: Record<string, MessageKey> = {
	connector: "panel.lit.channelConnector",
	web: "panel.lit.channelWeb",
};

/** 「产物」页签的文献回执卡：DOI · Zotero key · Vault 笔记 · 全文状态；只展示宿主读回的身份，不代表科学结论。 */
export function LiteratureReceipts({ sessionId }: { sessionId: string | null }) {
	const t = useT();
	const cwd = useSessionsStore((s) => s.cwd);
	const flow = useKnowledgeStore((s) => (sessionId ? s.flows[sessionId] : undefined));
	const [notePath, setNotePath] = useState<string | null>(null);
	const rows: KnowledgeLiteratureRow[] = flow?.literature ?? [];
	if (!rows.length) return null;
	const label = (status: string | null | undefined): string => {
		const key = status ? STATUS_KEYS[status] : undefined;
		return key ? t(key) : status || t("panel.lit.unknown");
	};
	const openZotero = (key: string) =>
		void getPi()
			.openResourceExternal(`zotero://select/library/items/${key}`, cwd || undefined)
			.catch(reportKnowledgeError);
	const openDoi = (doi: string) =>
		void getPi()
			.openExternal(`https://doi.org/${encodeURI(doi)}`)
			.catch(reportKnowledgeError);
	return (
		<section className="panel-card" data-testid="literature-receipts">
			<header className="text-[12px] font-medium text-ink">{t("panel.literature")}</header>
			<p className="mt-0.5 text-[11px] text-ink-faint">{t("panel.literatureHint")}</p>
			<ul className="mt-1 space-y-2">
				{[...rows].reverse().map((row) => {
					const zoteroKey = row.zoteroKey && ZOTERO_KEY.test(row.zoteroKey) ? row.zoteroKey : null;
					const status = row.source === "zotero-save" ? row.status : row.zotero;
					const channelKey = row.channel ? CHANNEL_KEYS[row.channel] : undefined;
					return (
						<li key={row.key} className="rounded-lg bg-hover p-2 text-[11px]">
							<p className="break-words font-medium text-ink" title={row.title || row.doi}>
								{row.title || row.doi}
							</p>
							<p className="break-all font-mono text-ink-faint">DOI {row.doi}</p>
							<dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
								<dt className="text-ink-dim">Zotero</dt>
								<dd className={`break-all ${literatureTone(status)}`}>
									{label(status)}
									{zoteroKey ? <code className="ml-1 text-ink-faint">{zoteroKey}</code> : null}
									{channelKey ? <span className="ml-1 text-ink-faint">{t(channelKey)}</span> : null}
									{row.library ? <span className="ml-1 text-ink-faint">· {row.library}</span> : null}
								</dd>
								<dt className="text-ink-dim">{t("panel.lit.vaultNote")}</dt>
								<dd
									className={`break-all ${row.obsidian === "unknown" ? "text-ink-dim" : literatureTone(row.obsidian)}`}
								>
									{label(row.obsidian)}
									{row.notePath ? <code className="ml-1 text-ink-faint">{row.notePath}</code> : null}
								</dd>
								<dt className="text-ink-dim">{t("panel.lit.fulltext")}</dt>
								<dd className={row.fulltextStatus ? literatureTone(row.fulltextStatus) : "text-ink-dim"}>
									{label(row.fulltextStatus || "unknown")}
								</dd>
							</dl>
							<div className="mt-1.5 flex flex-wrap gap-1.5">
								{zoteroKey && (
									<Button size="sm" onClick={() => openZotero(zoteroKey)}>
										{t("panel.lit.openInZotero")}
									</Button>
								)}
								{row.notePath && flow?.bindingRevision ? (
									<Button size="sm" onClick={() => setNotePath(row.notePath)}>
										{t("panel.lit.openNote")}
									</Button>
								) : null}
								<Button size="sm" onClick={() => openDoi(row.doi)}>
									{t("panel.lit.openDoi")}
								</Button>
							</div>
						</li>
					);
				})}
			</ul>
			{notePath && flow?.bindingRevision ? (
				<div className="mt-2">
					<KnowledgeNoteViewer
						cwd={cwd}
						path={notePath}
						revision={flow.bindingRevision}
						onClose={() => setNotePath(null)}
					/>
				</div>
			) : null}
		</section>
	);
}
