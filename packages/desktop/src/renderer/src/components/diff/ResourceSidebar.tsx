import type { ResourcePreviewResult } from "@drone/shared";
import { useEffect, useState } from "react";
import { getPi } from "../../api";
import { useT } from "../../i18n";
import type { ResourcePreviewTarget } from "../../stores/ui";
import { useUiStore } from "../../stores/ui";
import { CloseIcon } from "../icons";

function isWeb(href: string): boolean {
	return /^https?:\/\//i.test(href);
}

function isExternalProtocol(href: string): boolean {
	return /^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith("file://");
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
	const [result, setResult] = useState<ResourcePreviewResult | null>(null);
	const [error, setError] = useState<string | null>(null);
	const web = isWeb(target.href);
	const externalProtocol = isExternalProtocol(target.href);

	useEffect(() => {
		setResult(null);
		setError(null);
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

	const openExternal = () => void getPi().openResourceExternal(target.href, target.cwd);
	const title = target.label || result?.name || target.href;
	const src = result ? dataUrl(result) : null;

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
				) : result.kind === "image" && src ? (
					<div className="resource-media">
						<img src={src} alt={result.name} />
					</div>
				) : result.kind === "pdf" && src ? (
					<iframe className="resource-frame" src={src} title={result.name} />
				) : result.kind === "text" ? (
					<pre className="resource-text">{result.text}</pre>
				) : (
					<div className="resource-empty">{t("resource.binaryHint")}</div>
				)}
			</div>
			{result && (
				<div className="resource-meta">
					<span>{result.name}</span>
					<span>{formatBytes(result.size)}</span>
					<span>{result.mimeType}</span>
					{result.truncated && <span>{t("resource.truncated")}</span>}
				</div>
			)}
		</>
	);
}
