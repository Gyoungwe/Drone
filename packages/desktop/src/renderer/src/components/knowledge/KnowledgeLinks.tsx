import type { KnowledgeLinkRef, KnowledgeNoteLinks } from "@drone/shared";
import { useEffect, useState } from "react";
import { getPi } from "../../api";
import { useKnowledgeStore } from "../../stores/knowledge";
import { useKnowledgeText } from "./copy";

/** 打开另一篇笔记（保持当前知识库视图的会话与目录上下文） */
export function openKnowledgeNote(cwd: string | null, path: string, revision: number): void {
	const store = useKnowledgeStore.getState();
	store.open({
		cwd,
		sessionId: store.dialog?.sessionId ?? null,
		tab: "reviews",
		note: path,
		noteRevision: revision,
	});
}

/** 笔记的双向链接：反链（链接到本笔记的）与出链（本笔记链接到的），点击即打开 */
export function KnowledgeLinks({
	cwd,
	path,
	revision,
}: {
	cwd: string | null;
	path: string;
	revision: number;
}) {
	const t = useKnowledgeText();
	const nonce = useKnowledgeStore((s) => s.revision);
	const [links, setLinks] = useState<KnowledgeNoteLinks | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: nonce 是知识库变化后的刷新信号
	useEffect(() => {
		let live = true;
		setLinks(null);
		void getPi()
			.getKnowledgeNoteLinks({ path, revision })
			.then(
				(value) => {
					if (live) setLinks(value);
				},
				() => {},
			);
		return () => {
			live = false;
		};
	}, [path, revision, nonce]);
	if (!links) return null;
	const list = (items: KnowledgeLinkRef[], empty: string) =>
		items.length === 0 ? (
			<p className="text-[11px] text-ink-faint">{empty}</p>
		) : (
			<ul className="space-y-0.5">
				{items.map((item) => (
					<li key={item.path}>
						{item.exists ? (
							<button
								type="button"
								className="text-left text-[11px] text-accent hover:underline"
								title={item.path}
								onClick={() => openKnowledgeNote(cwd, item.path, revision)}
							>
								{item.title}
							</button>
						) : (
							<span className="text-[11px] text-ink-faint" title={t("linkMissing")}>
								{item.title} · {t("linkMissing")}
							</span>
						)}
					</li>
				))}
			</ul>
		);
	return (
		<div
			className="mt-3 grid grid-cols-2 gap-3 rounded-lg border border-border p-3"
			data-testid="knowledge-links"
		>
			<div>
				<h5 className="mb-1 text-[11px] font-semibold">
					{t("linksIncoming")} · {links.incoming.length}
				</h5>
				{list(links.incoming, t("linksIncomingEmpty"))}
			</div>
			<div>
				<h5 className="mb-1 text-[11px] font-semibold">
					{t("linksOutgoing")} · {links.outgoing.length}
				</h5>
				{list(links.outgoing, t("linksOutgoingEmpty"))}
			</div>
		</div>
	);
}
