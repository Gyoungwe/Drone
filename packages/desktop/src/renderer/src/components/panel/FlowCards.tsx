import type { KnowledgeFlowCard, KnowledgeFlowCardField, KnowledgeFlowCardLink } from "@drone/shared";
import { useState } from "react";
import { translateOptional, useI18nStore, useT } from "../../i18n";
import { Slot } from "../../plugins/Slot";
import { type SlotPropsMap, UI_SLOTS } from "../../plugins/slots";
import { useKnowledgeStore } from "../../stores/knowledge";
import { useSessionsStore } from "../../stores/sessions";
import { KnowledgeNoteViewer } from "../knowledge/KnowledgeNoteViewer";
import { Button } from "../ui/Button";
import { CARD_TONE_CLASS, followCardLink, toneForStatus } from "./card-links";

/** 槽位 fallback：宿主默认渲染 */
function DefaultArtifactsCard({ renderDefault }: SlotPropsMap[typeof UI_SLOTS.ArtifactsCard]) {
	return <>{renderDefault()}</>;
}

/**
 * 「产物」页签的通用回执卡（挂钩 3）：归档 / 入库 / 总结 / 文献 / Wiki 候选都走 `flow.cards[]`，
 * 由扩展在工具结果或 `drone.flowCards` 里贡献；这里只负责本地化状态记号与执行动作链接。
 * 每张卡经 `panel.artifacts.card` 槽位（挂钩 4），插件可按 kind 换成领域渲染。
 * 只展示宿主读回的事实，不代表科学结论已核验。
 */
export function FlowCards({ sessionId }: { sessionId: string | null }) {
	const t = useT();
	const flow = useKnowledgeStore((s) => (sessionId ? s.flows[sessionId] : undefined));
	const cwd = useSessionsStore((s) => s.cwd);
	const [notePath, setNotePath] = useState<string | null>(null);
	const cards: KnowledgeFlowCard[] = flow?.cards ?? [];
	if (!cards.length) return null;
	const openNote = flow?.bindingRevision ? setNotePath : undefined;
	return (
		<section className="panel-card" data-testid="flow-cards">
			<header className="text-[12px] font-medium text-ink">{t("flow.title")}</header>
			<p className="mt-0.5 text-[11px] text-ink-faint">{t("flow.hint")}</p>
			<ul className="mt-1 space-y-2">
				{[...cards].reverse().map((card) => (
					<li key={card.key} className="rounded-lg bg-hover p-2 text-[11px]" data-card-kind={card.kind}>
						<Slot
							name={UI_SLOTS.ArtifactsCard}
							props={{
								card,
								sessionId,
								renderDefault: () => <FlowCardBody card={card} cwd={cwd} onNote={openNote} />,
							}}
							fallback={DefaultArtifactsCard}
						/>
					</li>
				))}
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

/** 宿主默认卡体：标题 / 状态 / 副标题 / 字段表 / 动作链接 */
export function FlowCardBody({
	card,
	cwd,
	onNote,
}: {
	card: KnowledgeFlowCard;
	cwd?: string | null;
	onNote?: (path: string) => void;
}) {
	const language = useI18nStore((s) => s.language);
	const optional = (key: string | undefined, fallback: string) =>
		(key ? translateOptional(language, key) : null) ?? fallback;
	const statusLabel = (status: string) => optional(`flow.status.${status}`, status);
	const tone = (value: KnowledgeFlowCard["tone"], status?: string) =>
		CARD_TONE_CLASS[value ?? toneForStatus(status)];
	const canFollow = (link: KnowledgeFlowCardLink) => link.kind !== "note" || !!onNote;
	return (
		<>
			<div className="flex items-start justify-between gap-2">
				<p className="min-w-0 break-words font-medium text-ink" title={card.title}>
					{card.title}
				</p>
				<span className={`shrink-0 ${tone(card.tone, card.status)}`}>{statusLabel(card.status)}</span>
			</div>
			{card.subtitle ? <p className="break-all font-mono text-ink-faint">{card.subtitle}</p> : null}
			{card.path && !card.subtitle ? <p className="break-all font-mono text-ink-faint">{card.path}</p> : null}
			{card.detail ? <p className="mt-0.5 break-words text-ink-dim">{card.detail}</p> : null}
			{card.fields?.length ? (
				<dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
					{card.fields.map((field: KnowledgeFlowCardField) => (
						<FieldRow
							key={`${card.key}:${field.label}`}
							field={field}
							label={optional(field.i18n, field.label)}
							value={field.status ? statusLabel(field.value) : field.value}
							className={tone(field.tone, field.status ? field.value : undefined)}
						/>
					))}
				</dl>
			) : null}
			{card.links?.length ? (
				<div className="mt-1.5 flex flex-wrap gap-1.5">
					{card.links.map((link) =>
						canFollow(link) ? (
							<Button
								key={`${link.kind}:${link.target}`}
								size="sm"
								onClick={() => followCardLink(link, { cwd, label: card.title, onNote })}
							>
								{optional(link.i18n, link.label)}
							</Button>
						) : null,
					)}
				</div>
			) : null}
		</>
	);
}

function FieldRow({
	field,
	label,
	value,
	className,
}: {
	field: KnowledgeFlowCardField;
	label: string;
	value: string;
	className: string;
}) {
	return (
		<>
			<dt className="text-ink-dim">{label}</dt>
			<dd className={`break-all ${className}`}>
				{value}
				{field.code ? <code className="ml-1 text-ink-faint">{field.code}</code> : null}
				{field.note ? <span className="ml-1 text-ink-faint">· {field.note}</span> : null}
			</dd>
		</>
	);
}
