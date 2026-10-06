import "./resource-reader.css";
import {
	filePreviewDirectory,
	isLocalResourceTarget,
	type ResourcePreviewResult,
	resourceFormat,
	resourceHeadingId,
	splitResourceLink,
} from "@drone/shared";
import { useEffect, useState } from "react";
import { getPi } from "../../api";
import { useT } from "../../i18n";
import type { ResourcePreviewTarget } from "../../stores/ui";
import { useUiStore } from "../../stores/ui";
import { CloseIcon } from "../icons";
import { FigureAnnotator } from "./FigureAnnotator";
import { ResourceCode } from "./ResourceCode";
import { ResourceTextPreview } from "./ResourceTextPreview";

function isWeb(href: string): boolean {
	return /^https?:\/\//i.test(href);
}

function isExternalProtocol(href: string): boolean {
	return !isLocalResourceTarget(href);
}

function dataUrl(result: ResourcePreviewResult): string | null {
	return result.data ? `data:${result.mimeType};base64,${result.data}` : null;
}

function formatBytes(size: number): string {
	if (size < 1024) return `${size} B`;
	if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
	return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function ResourceSidebar({ target }: { target: ResourcePreviewTarget }) {
	const t = useT();
	const setPanelOpen = useUiStore((s) => s.setPanelOpen);
	const showDiff = useUiStore((s) => s.showDiffSidebar);
	const openPreview = useUiStore((s) => s.openResourcePreview);
	const [mode, setMode] = useState<"preview" | "source">("preview");
	const [zoom, setZoom] = useState(1);
	const [imageError, setImageError] = useState(false);
	const [navigationError, setNavigationError] = useState("");
	const [result, setResult] = useState<ResourcePreviewResult | null>(null);
	const [error, setError] = useState<string | null>(null);
	const web = isWeb(target.href);
	const externalProtocol = isExternalProtocol(target.href);

	useEffect(() => {
		setResult(null);
		setError(null);
		setMode("preview");
		setZoom(1);
		setImageError(false);
		setNavigationError("");
		if (web || externalProtocol) return;
		let cancelled = false;
		void getPi()
			.previewFile(target.href, target.cwd)
			.then((next) => {
				if (!cancelled) setResult(next);
			})
			.catch((err) => {
				if (!cancelled) setError(err instanceof Error ? err.message : String(err));
			});
		return () => {
			cancelled = true;
		};
	}, [target.href, target.cwd, web, externalProtocol]);

	useEffect(() => {
		if (!result || !target.fragment || mode !== "preview") return;
		document.getElementById(resourceHeadingId(target.fragment))?.scrollIntoView({ block: "start" });
	}, [result, target.fragment, mode]);

	const openExternal = () =>
		void getPi()
			.openResourceExternal(target.href, target.cwd)
			.catch((e) => setNavigationError(String(e.message || e)));
	const navigate = (href: string, label?: string) => {
		if (!href || (!isLocalResourceTarget(href) && !/^(?:https?|mailto|obsidian|zotero):/i.test(href))) {
			setNavigationError(t("resource.viewer.unsupportedLink"));
			return;
		}
		const destination = isLocalResourceTarget(href) ? splitResourceLink(href) : { href };
		openPreview({ ...destination, label, cwd: result ? filePreviewDirectory(result.path) : target.cwd });
	};
	const title = target.label || result?.name || target.href;
	const src = result ? dataUrl(result) : null;
	const format = resourceFormat(result?.name || "");

	return (
		<>
			<div className="diff-side-head border-b border-border">
				<button type="button" className="resource-back" onClick={showDiff}>
					{t("resource.backToChanges")}
				</button>
				<span className="resource-title" title={title}>
					{title}
				</span>
				<button type="button" className="resource-open" onClick={openExternal}>
					{t("resource.openExternal")}
				</button>
				<button
					type="button"
					className="diff-side-close"
					onClick={() => setPanelOpen(false)}
					aria-label={t("common.close")}
				>
					<CloseIcon />
				</button>
			</div>
			<div className="resource-address" title={target.href}>
				{target.href}
			</div>
			{result && (
				<div className="resource-reader-toolbar">
					<span className="resource-format">
						{result.kind === "text" ? format.label : result.kind.toUpperCase()}
					</span>
					{result.text !== undefined && (
						<>
							<button type="button" aria-pressed={mode === "preview"} onClick={() => setMode("preview")}>
								{t("resource.viewer.preview")}
							</button>
							<button type="button" aria-pressed={mode === "source"} onClick={() => setMode("source")}>
								{t("resource.viewer.source")}
							</button>
						</>
					)}
					{result.kind === "image" && mode === "preview" && (
						<>
							<button
								type="button"
								aria-label={t("resource.viewer.zoomOut")}
								onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
							>
								−
							</button>
							<button type="button" onClick={() => setZoom(1)}>
								{Math.round(zoom * 100)}%
							</button>
							<button
								type="button"
								aria-label={t("resource.viewer.zoomIn")}
								onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
							>
								＋
							</button>
						</>
					)}
				</div>
			)}
			{navigationError && (
				<p role="alert" className="resource-notice">
					{navigationError}
				</p>
			)}
			{result?.truncated && (
				<p className="resource-notice" role="status">
					{result.kind === "text" ? t("resource.viewer.textTruncated") : t("resource.viewer.mediaTruncated")}
				</p>
			)}
			<div className="resource-body">
				{web ? (
					<iframe className="resource-frame" src={target.href} title={title} referrerPolicy="no-referrer" />
				) : externalProtocol ? (
					<div className="resource-empty">
						<div>{t("resource.externalProtocol")}</div>
						<button type="button" className="resource-primary" onClick={openExternal}>
							{t("resource.openExternal")}
						</button>
					</div>
				) : error ? (
					<div className="resource-empty">
						<div>{t("resource.previewFailed")}</div>
						<div className="resource-error">{error}</div>
						<button type="button" className="resource-primary" onClick={openExternal}>
							{t("resource.openExternal")}
						</button>
					</div>
				) : !result ? (
					<div className="resource-empty">{t("resource.loading")}</div>
				) : mode === "source" && result.text !== undefined ? (
					<ResourceCode
						text={result.text}
						language={result.name.toLowerCase().endsWith(".svg") ? "xml" : format.language}
					/>
				) : result.kind === "image" && src ? (
					<div className="resource-media">
						{imageError ? (
							<p className="resource-notice" role="status">
								{t("resource.viewer.imageDecodeFailed")}
							</p>
						) : (
							<FigureAnnotator
								source={{ href: target.href, cwd: target.cwd }}
								name={result.name}
								path={result.path}
								width={`${zoom * 100}%`}
							>
								<img
									src={src}
									alt={result.name}
									style={{ width: "100%", maxWidth: "none", maxHeight: "none" }}
									onError={() => setImageError(true)}
								/>
							</FigureAnnotator>
						)}
					</div>
				) : result.kind === "pdf" && src ? (
					<iframe
						className="resource-frame"
						src={`${src}#toolbar=1&navpanes=0&view=FitH`}
						title={result.name}
					/>
				) : result.kind === "text" ? (
					<ResourceTextPreview
						key={result.path}
						text={result.text || ""}
						name={result.name}
						onNavigate={navigate}
						source={{ href: target.href, cwd: target.cwd }}
						path={result.path}
					/>
				) : (
					<div className="resource-empty">
						{result.kind === "binary" ? (
							<>
								{t("resource.binaryHint")}
								<p>{t("resource.viewer.binaryFormats")}</p>
							</>
						) : (
							<p>{t("resource.viewer.mediaTooLarge")}</p>
						)}
					</div>
				)}
			</div>
			{result && (
				<div className="resource-meta">
					<span>{result.name}</span>
					<span>
						{formatBytes(result.size)}
						{result.compression && t("resource.viewer.compressed")}
					</span>
					{result.encoding && <span>{result.encoding}</span>}
					{result.compression && <span>{t("resource.viewer.gzipExcerpt")}</span>}
					<span>{result.mimeType}</span>
					{result.truncated && <span>{t("resource.truncated")}</span>}
				</div>
			)}
		</>
	);
}
