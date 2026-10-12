import {
	basenameOf,
	type DeliveredFile,
	fileTypeOf,
	localResourceHref,
	type PreviewKind,
} from "@drone/shared";
import { useT } from "../../i18n";
import { useSessionsStore } from "../../stores/sessions";
import { useUiStore } from "../../stores/ui";
import { contextMenuHandler } from "../ui/ContextMenu";
import { buildFileMenu } from "../ui/file-menu";

const KIND_GLYPH: Partial<Record<PreviewKind, string>> = {
	pdf: "PDF",
	image: "IMG",
	svg: "SVG",
	table: "TSV",
	notebook: "NB",
	markdown: "MD",
	html: "WEB",
	code: "</>",
	audio: "♪",
	video: "▶",
	mesh: "3D",
	array: "NPY",
};

function glyph(path: string): string {
	return (
		KIND_GLYPH[fileTypeOf(path).previewKind] ??
		(basenameOf(path).split(".").pop()?.slice(0, 4).toUpperCase() || "FILE")
	);
}

/** 横向交付卡（P17）：图标 / 标题 / 摘要 / 打开；点击在右栏 PreviewHost 打开。 */
export function DeliveryCards({ files, sessionId }: { files: DeliveredFile[]; sessionId: string | null }) {
	const t = useT();
	const cwd = useSessionsStore(
		(s) =>
			s.sessions.find((session) => session.sessionId === sessionId)?.cwd ??
			(s.activeSessionId === sessionId ? s.cwd : undefined),
	);
	const open = useUiStore((s) => s.openResourcePreview);
	if (!files.length) return null;
	return (
		<div className="delivery-cards" data-testid="delivery-cards">
			{files.map((file) => {
				const href = localResourceHref(file.path) ?? file.path;
				const onOpen = () => open({ href, label: file.title, cwd: cwd ?? undefined });
				return (
					<button
						type="button"
						key={file.path}
						className="delivery-card"
						title={file.path}
						onClick={onOpen}
						onContextMenu={contextMenuHandler(() => buildFileMenu({ path: href, cwd: cwd ?? undefined }, t))}
					>
						<span className="delivery-card-icon" aria-hidden="true">
							{glyph(file.path)}
						</span>
						<span className="delivery-card-text">
							<span className="delivery-card-title">{file.title}</span>
							<span className="delivery-card-desc">{file.description ?? basenameOf(file.path)}</span>
						</span>
						<span className="delivery-card-open">{t("delivery.open")}</span>
					</button>
				);
			})}
		</div>
	);
}
