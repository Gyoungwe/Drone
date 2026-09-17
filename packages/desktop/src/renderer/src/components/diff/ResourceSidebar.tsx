import "./resource-reader.css";
import {
	filePreviewDirectory,
	splitResourceLink,
	resourceHeadingId,
	isLocalResourceTarget,
	type ResourcePreviewResult,
	resourceFormat,
} from "@drone/shared";
import { useEffect, useState } from "react";
import { getPi } from "../../api";
import { useT } from "../../i18n";
import type { ResourcePreviewTarget } from "../../stores/ui";
import { useUiStore } from "../../stores/ui";
import { CloseIcon } from "../icons";
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
	const setOpen = useUiStore((s) => s.setDiffSidebarOpen);
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
			setNavigationError("此链接类型不能在预览器中打开。");
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
					onClick={() => setOpen(false)}
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
								预览
							</button>
							<button type="button" aria-pressed={mode === "source"} onClick={() => setMode("source")}>
								源码
							</button>
						</>
					)}
					{result.kind === "image" && mode === "preview" && (
						<>
							<button
								type="button"
								aria-label="缩小图片"
								onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
							>
								−
							</button>
							<button type="button" onClick={() => setZoom(1)}>
								{Math.round(zoom * 100)}%
							</button>
							<button
								type="button"
								aria-label="放大图片"
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
					{result.kind === "text"
						? "文件受读取上限限制：最多预览 128 KiB 文本字节；这不是完整文件或全文件统计。"
						: "媒体文件超过预览上限（图片/PDF 16 MiB，SVG 128 KiB），请在外部查看完整文件。"}
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
								图像无法解码，请检查文件是否完整；SVG 可切换源码查看。
							</p>
						) : (
							<img
								src={src}
								alt={result.name}
								style={{ width: `${zoom * 100}%`, maxWidth: "none", maxHeight: "none" }}
								onError={() => setImageError(true)}
							/>
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
					/>
				) : (
					<div className="resource-empty">
						{result.kind === "binary" ? (
							<>
								{t("resource.binaryHint")}
								<p>二进制科研格式（如 BAM、CRAM、BCF、HDF5、Parquet）需要专用查看器，不会按文本强行解码。</p>
							</>
						) : (
							<p>文件超过内嵌媒体预览上限，请在外部查看完整文件。</p>
						)}
					</div>
				)}
			</div>
			{result && (
				<div className="resource-meta">
					<span>{result.name}</span>
					<span>
						{formatBytes(result.size)}
						{result.compression && "（压缩文件）"}
					</span>
					{result.encoding && <span>{result.encoding}</span>}
					{result.compression && <span>gzip 片段 · 不代表全文件完整性校验</span>}
					<span>{result.mimeType}</span>
					{result.truncated && <span>{t("resource.truncated")}</span>}
				</div>
			)}
		</>
	);
}
