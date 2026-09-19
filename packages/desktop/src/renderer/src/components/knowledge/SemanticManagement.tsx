import type {
	KnowledgeSemanticConfig,
	KnowledgeSemanticIndexResult,
	KnowledgeSemanticStatus,
} from "@drone/shared";
import { useEffect, useRef, useState } from "react";
import { getPi } from "../../api";
import { Button } from "../ui/Button";
import { useKnowledgeText } from "./copy";

const EMPTY_CONFIG: KnowledgeSemanticConfig = {
	provider: "none",
	enabled: false,
	baseUrl: "",
	model: "",
	credentialEnv: "",
	remoteConsent: false,
	minSimilarity: 0.45,
};

export function SemanticManagement({
	cwd,
	bindingRevision,
}: {
	cwd: string | null;
	bindingRevision: number;
}) {
	const t = useKnowledgeText();
	const [status, setStatus] = useState<KnowledgeSemanticStatus | null>(null);
	const [config, setConfig] = useState<KnowledgeSemanticConfig>(EMPTY_CONFIG);
	const [busy, setBusy] = useState(false);
	const [indexing, setIndexing] = useState(false);
	const [result, setResult] = useState<KnowledgeSemanticIndexResult | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const epoch = useRef(0);
	const requestIdRef = useRef<string | null>(null);
	useEffect(() => {
		const current = ++epoch.current;
		setStatus(null);
		setError(null);
		void getPi()
			.getKnowledgeSemanticStatus({ cwd, bindingRevision })
			.then((next) => {
				if (current !== epoch.current) return;
				setStatus(next);
				setConfig({ ...EMPTY_CONFIG, ...next.settings });
			})
			.catch((e) => current === epoch.current && setError(e instanceof Error ? e.message : String(e)));
		return () => {
			epoch.current++;
		};
	}, [cwd, bindingRevision]);
	function update<K extends keyof KnowledgeSemanticConfig>(key: K, value: KnowledgeSemanticConfig[K]) {
		setConfig((current) => ({ ...current, [key]: value }));
	}
	const saved = Boolean(
		status &&
			(
				[
					"provider",
					"enabled",
					"baseUrl",
					"model",
					"credentialEnv",
					"remoteConsent",
					"minSimilarity",
				] as const
			).every((key) => config[key] === status.settings[key]),
	);
	async function save() {
		if (busy) return;
		setBusy(true);
		setError(null);
		setMessage(null);
		try {
			const safe = await getPi().saveKnowledgeSemanticSettings({
				config,
				bindingRevision,
				expectedSettingsRevision: status?.settings.revision ?? 0,
			});
			setStatus((current) => (current ? { ...current, settings: safe } : current));
			setConfig({ ...EMPTY_CONFIG, ...safe });
			setMessage(t("semanticSaved"));
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}
	async function test() {
		if (busy) return;
		setBusy(true);
		setError(null);
		setMessage(null);
		try {
			await getPi().testKnowledgeSemanticProvider({ config, bindingRevision });
			setMessage(t("semanticTested"));
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}
	async function startIndex() {
		const projectCwd = cwd;
		if (!projectCwd || busy || indexing || !saved || !config.enabled || config.provider === "none") return;
		const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
		const scopeEpoch = epoch.current;
		requestIdRef.current = requestId;
		setIndexing(true);
		setError(null);
		setMessage(null);
		try {
			const next = await getPi().indexKnowledgeSemantic({
				cwd: projectCwd,
				bindingRevision,
				requestId,
				limit: 8,
			});
			if (scopeEpoch === epoch.current) {
				setResult(next);
				setMessage(t("semanticIndex"));
			}
		} catch (e) {
			if (scopeEpoch === epoch.current) setError(e instanceof Error ? e.message : String(e));
		} finally {
			if (scopeEpoch === epoch.current) {
				setIndexing(false);
				requestIdRef.current = null;
			}
		}
	}
	async function cancelIndex() {
		if (!indexing || !cwd) return;
		setError(null);
		try {
			const requestId = requestIdRef.current;
			if (!requestId) return;
			await getPi().cancelKnowledgeSemanticIndex({ cwd, bindingRevision, requestId });
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	}
	return (
		<section className="space-y-3" data-testid="knowledge-semantic">
			<p className="text-[11px] text-ink-dim">{t("semanticOptIn")}</p>
			<div className="grid gap-2 sm:grid-cols-2">
				<label className="text-xs text-ink-dim">
					{t("provider")}
					<select
						value={config.provider}
						onChange={(e) => update("provider", e.target.value as KnowledgeSemanticConfig["provider"])}
						className="mt-1 w-full rounded-lg border border-border bg-surface px-2 py-2 text-xs text-ink"
					>
						<option value="none">{t("providerNone")}</option>
						<option value="ollama">{t("providerOllama")}</option>
						<option value="openai-compatible">{t("providerOpenAI")}</option>
					</select>
				</label>
				<label className="flex items-center gap-2 pt-5 text-xs">
					<input
						type="checkbox"
						checked={config.enabled}
						onChange={(e) => update("enabled", e.target.checked)}
					/>
					{t("semantic")}
				</label>
			</div>
			<label className="block text-xs text-ink-dim">
				{t("endpoint")}
				<input
					value={config.baseUrl}
					onChange={(e) => update("baseUrl", e.target.value)}
					className="mt-1 w-full rounded-lg border border-border bg-surface px-2 py-2 text-xs text-ink"
				/>
			</label>
			<label className="block text-xs text-ink-dim">
				{t("modelName")}
				<input
					value={config.model}
					onChange={(e) => update("model", e.target.value)}
					className="mt-1 w-full rounded-lg border border-border bg-surface px-2 py-2 text-xs text-ink"
				/>
			</label>
			<label className="block text-xs text-ink-dim">
				{t("semanticMinSimilarity")}
				<input
					type="number"
					min="0"
					max="1"
					step="0.05"
					value={config.minSimilarity ?? 0.45}
					onChange={(e) => update("minSimilarity", Number(e.target.value))}
					className="mt-1 w-full rounded-lg border border-border bg-surface px-2 py-2 text-xs text-ink"
				/>
				<span className="mt-1 block text-[11px] text-ink-faint">{t("semanticMinSimilarityHint")}</span>
			</label>
			<label className="block text-xs text-ink-dim">
				{t("credentialEnv")}
				<input
					value={config.credentialEnv}
					onChange={(e) => update("credentialEnv", e.target.value)}
					autoComplete="off"
					className="mt-1 w-full rounded-lg border border-border bg-surface px-2 py-2 font-mono text-xs text-ink"
				/>
			</label>
			<label className="flex items-start gap-2 text-xs">
				<input
					type="checkbox"
					checked={config.remoteConsent}
					onChange={(e) => update("remoteConsent", e.target.checked)}
				/>
				<span>{t("remoteConsent")}</span>
			</label>
			<p className="text-[11px] text-ink-dim">{t("testSemanticHint")}</p>
			<div className="flex flex-wrap gap-1">
				<Button size="sm" disabled={busy} onClick={() => void save()}>
					{t("saveSemantic")}
				</Button>
				<Button
					size="sm"
					disabled={busy || !config.enabled || config.provider === "none"}
					onClick={() => void test()}
				>
					{t("testSemantic")}
				</Button>
			</div>
			<div className="border-t border-border pt-3">
				<p className="text-[11px] text-ink-dim">{t("semanticIndexHint")}</p>
				<div className="mt-2 flex flex-wrap gap-1">
					<Button
						size="sm"
						variant="primary"
						disabled={!cwd || busy || indexing || !saved || !config.enabled || config.provider === "none"}
						onClick={() => void startIndex()}
					>
						{indexing ? t("semanticIndexing") : t("semanticIndex")}
					</Button>
					<Button size="sm" disabled={!indexing} onClick={() => void cancelIndex()}>
						{t("semanticCancel")}
					</Button>
				</div>
				{(!config.enabled || !saved) && <p className="mt-2 text-[11px] text-warn">{t("semanticDisabled")}</p>}
			</div>
			{status?.index && (
				<p className="text-[11px] text-ink-dim">
					{t("topicStatus")}: {String(status.index.coverage ?? status.index.status ?? t("unknown"))}
					{status.index.semantic?.vectors !== undefined
						? ` · ${t("processed")}: ${status.index.semantic.vectors}`
						: ""}
				</p>
			)}
			{result && (
				<p className="text-[11px] text-ink-dim">
					{t("processed")}: {result.processed ?? "—"}
					{result.dimension ? ` · ${t("semanticDimension")}: ${result.dimension}` : ""}.{" "}
					{t("semanticFallback")}
				</p>
			)}
			{message && (
				<p role="status" className="text-xs text-ok">
					{message}
				</p>
			)}
			{error && (
				<p role="alert" className="break-words text-xs text-err">
					{error}
				</p>
			)}
		</section>
	);
}
