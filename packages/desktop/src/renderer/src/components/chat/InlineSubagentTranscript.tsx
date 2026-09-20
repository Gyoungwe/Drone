import {
	buildChatRows,
	emptyTranscript,
	messagesToUIMessages,
	type SessionTranscriptState,
	type UIMessage,
} from "@drone/shared";
import { useEffect, useMemo, useState } from "react";
import { getPi } from "../../api";
import { useT } from "../../i18n";
import type { SubagentRunUi } from "../../stores/transcript";
import { useTranscriptStore } from "../../stores/transcript";
import { AssistantMessage } from "./AssistantMessage";
import { ErrorNote } from "./ErrorNote";
import { imageSrc } from "./ImagePreview";
import { MetaGroup } from "./MetaGroup";
import { SystemMessage } from "./SystemMessage";
import { UserMessage } from "./UserMessage";

function InlineMessage({
	message,
	streaming,
	metaInGroup,
}: {
	message: UIMessage;
	streaming?: boolean;
	metaInGroup?: boolean;
}) {
	const t = useT();
	if (message.kind === "user") return <UserMessage message={message} />;
	if (message.kind === "assistant") {
		return (
			<AssistantMessage
				text={message.text}
				thinking={message.thinking}
				tools={message.tools}
				streaming={streaming}
				metaInGroup={metaInGroup}
			/>
		);
	}
	if (message.kind === "system") return <SystemMessage message={message} />;
	if (message.kind === "error")
		return <ErrorNote sessionId={null} cardId={message.id} error={message.error} />;
	if (message.kind === "image") {
		return (
			<div className="flex flex-wrap gap-2">
				{message.images.map((image, index) => (
					<img
						// biome-ignore lint/suspicious/noArrayIndexKey: immutable image list
						key={index}
						src={imageSrc(image)}
						alt={t("message.image")}
						className="max-h-28 max-w-40 rounded-lg border border-border object-contain"
					/>
				))}
			</div>
		);
	}
	if (message.kind === "subagent") {
		return (
			<div className="text-[11px] text-ink-faint">
				{t("message.summarySubagents", { n: message.runs.length })}
			</div>
		);
	}
	return null;
}

/** 子会话内联记录：运行中为实时流（子会话 transcript），结束后读 sessions-subagents/*.jsonl 快照（只读） */
export function InlineSubagentTranscript({ run }: { run: SubagentRunUi }) {
	const t = useT();
	const live = useTranscriptStore((state) => (run.sessionId ? state.bySession[run.sessionId] : undefined));
	const [snapshot, setSnapshot] = useState<UIMessage[] | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!run.sessionFile) return;
		if (live && (live.messages.length > 0 || live.streaming)) return;
		let cancelled = false;
		setLoading(true);
		setError(null);
		void getPi()
			.peekSubagentMessages(run.sessionFile)
			.then((messages) => {
				if (!cancelled) setSnapshot(messagesToUIMessages(messages));
			})
			.catch((err) => {
				if (!cancelled) setError(err instanceof Error ? err.message : String(err));
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [run.sessionFile, live]);

	const transcript = useMemo<SessionTranscriptState>(() => {
		if (live && (live.messages.length > 0 || live.streaming)) return live;
		return { ...emptyTranscript(), messages: snapshot ?? [] };
	}, [live, snapshot]);
	const rows = useMemo(
		() => buildChatRows(transcript, run.sessionId ?? run.key, Date.now()),
		[transcript, run.sessionId, run.key],
	);

	if (loading && rows.length === 0) {
		return (
			<div className="px-3 py-3 text-[11px] text-ink-faint">{t("message.subagent.loadingTranscript")}</div>
		);
	}
	if (error && rows.length === 0) {
		return (
			<div className="px-3 py-3 text-[11px] text-err">
				{t("message.subagent.transcriptError")}: {error}
			</div>
		);
	}
	if (rows.length === 0) {
		return <div className="px-3 py-3 text-[11px] text-ink-faint">{t("message.subagent.noTranscript")}</div>;
	}

	return (
		<div className="max-h-[420px] overflow-y-auto border-t border-border/60 bg-surface-2/30 px-3 py-3">
			<div className="flex flex-col gap-4">
				{rows.map((row) => {
					if (row.kind === "turnDiff") return null;
					if (row.kind === "metaGroup") {
						return (
							<MetaGroup
								key={row.key}
								items={row.items}
								working={row.working}
								endImmediately={row.endImmediately}
								subagentCount={row.subagentCount}
								statusText={row.statusText}
							/>
						);
					}
					if (row.kind === "streamingSubagents") {
						return (
							<div key={row.key} className="text-[11px] text-ink-faint">
								{t("message.summarySubagents", { n: row.runs.length })}
							</div>
						);
					}
					return (
						<InlineMessage
							key={row.key}
							message={row.message}
							streaming={row.streaming}
							metaInGroup={row.metaInGroup}
						/>
					);
				})}
			</div>
		</div>
	);
}
