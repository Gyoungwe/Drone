import type { ResearchCaptureRecord, ResourcePreviewResult } from "@drone/shared";
import { isLocalResourceTarget, resourceFormat, splitResourceLink } from "@drone/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getPi } from "../../api";
import { useT } from "../../i18n";
import { useSessionsStore } from "../../stores/sessions";
import { SearchIcon } from "../icons";
import { PreviewHost } from "../preview/PreviewHost";
import { hasSourceTab } from "../preview/preview-registry";
import { filterResearchPaths, normalizeProjectLink } from "./research-browser";
import "./research-browser.css";

function dataUrl(result: ResourcePreviewResult): string | null {
	return result.data ? `data:${result.mimeType};base64,${result.data}` : null;
}

function formatBytes(size: number): string {
	if (size < 1024) return `${size} B`;
	if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
	return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function isDirectory(path: string): boolean {
	return path.endsWith("/");
}

export function ResearchBrowserPage() {
	const t = useT();
	const cwd = useSessionsStore((s) => s.cwd);
	const [paths, setPaths] = useState<string[]>([]);
	const [selectedPath, setSelectedPath] = useState<string | null>(null);
	const [selectedCwd, setSelectedCwd] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [result, setResult] = useState<ResourcePreviewResult | null>(null);
	const [mode, setMode] = useState<"preview" | "source">("preview");
	const [zoom, setZoom] = useState(1);
	const [imageError, setImageError] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [captures, setCaptures] = useState<ResearchCaptureRecord[]>([]);
	const refreshGeneration = useRef(0);

	const refresh = useCallback(async () => {
		const requestCwd = cwd;
		const generation = ++refreshGeneration.current;
		if (!requestCwd) {
			setLoading(false);
			setPaths([]);
			setSelectedPath(null);
			setSelectedCwd(null);
			return;
		}
		setLoading(true);
		setError(null);
		try {
			const next = await getPi().listProjectFiles(requestCwd);
			if (generation !== refreshGeneration.current) return;
			setPaths(next);
			setSelectedCwd(requestCwd);
			setSelectedPath((current) => {
				if (current && next.includes(current)) return current;
				return next.find((path) => !isDirectory(path)) ?? null;
			});
		} catch (cause) {
			if (generation !== refreshGeneration.current) return;
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			if (generation === refreshGeneration.current) setLoading(false);
		}
	}, [cwd]);

	useEffect(() => {
		if (!cwd) {
			setCaptures([]);
			return;
		}
		let cancelled = false;
		void getPi()
			.listCaptures({ cwd })
			.then((next) => {
				if (!cancelled) setCaptures(next.items);
			})
			.catch((cause) => {
				if (!cancelled) setActionError(cause instanceof Error ? cause.message : String(cause));
			});
		return () => {
			cancelled = true;
		};
	}, [cwd]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	useEffect(() => {
		setResult(null);
		setActionError(null);
		setMode("preview");
		setZoom(1);
		setImageError(false);
		if (!cwd || !selectedPath || isDirectory(selectedPath)) return;
		const previewCwd = selectedCwd === cwd ? selectedCwd : cwd;
		let cancelled = false;
		void getPi()
			.previewFile(selectedPath, previewCwd, true)
			.then((next) => {
				if (!cancelled) setResult(next);
			})
			.catch((cause) => {
				if (!cancelled) setActionError(cause instanceof Error ? cause.message : String(cause));
			});
		return () => {
			cancelled = true;
		};
	}, [cwd, selectedCwd, selectedPath]);

	const visiblePaths = useMemo(() => filterResearchPaths(paths, query), [paths, query]);

	const openExternal = () => {
		if (!selectedPath || !cwd) return;
		setActionError(null);
		void getPi()
			.openResourceExternal(selectedPath, selectedCwd ?? cwd, true)
			.catch((cause) => setActionError(cause instanceof Error ? cause.message : String(cause)));
	};

	const selectedCapture = selectedPath
		? captures.filter((item) => item.relativePath === selectedPath).sort((a, b) => b.revision - a.revision)[0]
		: undefined;

	const captureCurrent = async () => {
		if (!selectedPath || !cwd) return;
		setActionError(null);
		try {
			const response = await getPi().captureResource({ cwd, relativePath: selectedPath, scope: "project" });
			setCaptures((current) => [
				...current.filter((item) => item.id !== response.record.id),
				response.record,
			]);
		} catch (cause) {
			setActionError(cause instanceof Error ? cause.message : String(cause));
		}
	};

	const approveCurrent = async () => {
		if (!selectedCapture) return;
		setActionError(null);
		try {
			const next = await getPi().approveCapture({ id: selectedCapture.id });
			setCaptures((current) => current.map((item) => (item.id === next.id ? next : item)));
		} catch (cause) {
			setActionError(cause instanceof Error ? cause.message : String(cause));
		}
	};

	const navigate = (href: string) => {
		if (!href || !cwd) return;
		if (isLocalResourceTarget(href)) {
			const destination = splitResourceLink(href);
			const currentPath = selectedPath ? `${cwd}/${selectedPath}` : cwd;
			const safeHref = normalizeProjectLink(destination.href, currentPath, cwd);
			if (!safeHref) {
				setActionError(t("researchBrowser.unsupportedLink"));
				return;
			}
			setSelectedCwd(cwd);
			setSelectedPath(safeHref);
			return;
		}
		setActionError(t("researchBrowser.unsupportedLink"));
	};

	const title = result?.name ?? selectedPath ?? t("researchBrowser.selectFile");
	const format = resourceFormat(result?.name ?? "");

	return (
		<div className="research-browser" data-testid="research-browser">
			<header className="research-browser-head">
				<div>
					<p className="research-browser-eyebrow">{t("researchBrowser.eyebrow")}</p>
					<h1>{t("researchBrowser.title")}</h1>
					<p className="research-browser-subtitle">{cwd ?? t("researchBrowser.noProject")}</p>
				</div>
				<div className="research-browser-actions">
					<button
						type="button"
						className="research-browser-button"
						onClick={() => void refresh()}
						disabled={loading || !cwd}
					>
						{loading ? t("researchBrowser.refreshing") : t("researchBrowser.refresh")}
					</button>
					{selectedPath && (
						<button type="button" className="research-browser-button" onClick={openExternal}>
							{t("researchBrowser.openExternal")}
						</button>
					)}
					{selectedPath && (
						<button type="button" className="research-browser-button" onClick={() => void captureCurrent()}>
							{t("researchBrowser.capture")}
						</button>
					)}
					{selectedCapture?.approval === "pending" && (
						<button type="button" className="research-browser-button" onClick={() => void approveCurrent()}>
							{t("researchBrowser.approveCapture")}
						</button>
					)}
				</div>
			</header>
			<div className="research-browser-body">
				<aside className="research-browser-files" aria-label={t("researchBrowser.fileList")}>
					<label className="research-browser-search">
						<SearchIcon size={14} />
						<input
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder={t("researchBrowser.search")}
							aria-label={t("researchBrowser.search")}
						/>
					</label>
					<div className="research-browser-count">
						{t("researchBrowser.fileCount", {
							count: visiblePaths.filter((path) => !isDirectory(path)).length,
						})}
					</div>
					{error && <p className="research-browser-error">{error}</p>}
					{!cwd ? (
						<p className="research-browser-empty">{t("researchBrowser.noProject")}</p>
					) : visiblePaths.length === 0 && !loading ? (
						<p className="research-browser-empty">{t("researchBrowser.noFiles")}</p>
					) : (
						<ul className="research-browser-list">
							{visiblePaths.map((path) => {
								const directory = isDirectory(path);
								return (
									<li key={path}>
										<button
											type="button"
											className={`research-browser-file${selectedPath === path ? " is-selected" : ""}${directory ? " is-directory" : ""}`}
											disabled={directory}
											onClick={() => {
												setSelectedCwd(cwd);
												setSelectedPath(path);
											}}
											title={path}
										>
											<span aria-hidden="true">{directory ? "▾" : "·"}</span>
											<strong>{path}</strong>
										</button>
									</li>
								);
							})}
						</ul>
					)}
				</aside>
				<section className="research-browser-preview" aria-label={t("researchBrowser.preview")}>
					<div className="research-browser-preview-head">
						<div className="research-browser-preview-title" title={title}>
							{title}
						</div>
						{result && (
							<div className="research-browser-toolbar">
								<span>{result.kind === "text" ? format.label : result.kind.toUpperCase()}</span>
								{hasSourceTab(result) && (
									<>
										<button
											type="button"
											aria-pressed={mode === "preview"}
											onClick={() => setMode("preview")}
										>
											{t("researchBrowser.previewMode")}
										</button>
										<button type="button" aria-pressed={mode === "source"} onClick={() => setMode("source")}>
											{t("researchBrowser.sourceMode")}
										</button>
									</>
								)}
								{result.kind === "image" && mode === "preview" && (
									<>
										<button type="button" onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}>
											−
										</button>
										<span>{Math.round(zoom * 100)}%</span>
										<button type="button" onClick={() => setZoom((value) => Math.min(3, value + 0.25))}>
											＋
										</button>
									</>
								)}
							</div>
						)}
					</div>
					{actionError && <p className="research-browser-error">{actionError}</p>}
					<div
						className="research-browser-preview-body"
						aria-busy={Boolean(selectedPath && !result && !actionError)}
					>
						{!cwd ? (
							<div className="research-browser-placeholder">{t("researchBrowser.noProject")}</div>
						) : !selectedPath ? (
							<div className="research-browser-placeholder">{t("researchBrowser.selectFile")}</div>
						) : actionError && !result ? (
							<div className="research-browser-placeholder">{t("researchBrowser.previewFailed")}</div>
						) : !result ? (
							<div className="research-browser-placeholder">{t("researchBrowser.loading")}</div>
						) : (
							<PreviewHost
								result={result}
								src={dataUrl(result)}
								mode={mode}
								zoom={zoom}
								imageError={imageError}
								onImageError={() => setImageError(true)}
								onNavigate={navigate}
								source={{ href: selectedPath, cwd: selectedCwd ?? cwd }}
							/>
						)}
					</div>
					{result && (
						<div className="research-browser-meta">
							<span>{formatBytes(result.size)}</span>
							<span>{result.mimeType}</span>
							{result.encoding && <span>{result.encoding}</span>}
							{result.truncated && <span>{t("researchBrowser.truncated")}</span>}
							{selectedCapture && (
								<span>{t(`researchBrowser.captureState.${selectedCapture.approval}`)}</span>
							)}
						</div>
					)}
				</section>
			</div>
		</div>
	);
}
