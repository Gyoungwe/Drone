import type { PluginCredentialEntry } from "@drone/shared";
import { useCallback, useEffect, useState } from "react";
import { getPi } from "../../api";
import { useLanguage } from "../../hooks/use-language";
import { useT } from "../../i18n";

const inputClass =
	"w-full rounded-lg border border-border px-3 py-2 text-[12px] outline-none focus:border-ink-faint";

/** One declared slot: the secret is write-only; non-secret fields show what was saved. */
function CredentialRow({ entry, onChanged }: { entry: PluginCredentialEntry; onChanged: () => void }) {
	const t = useT();
	const language = useLanguage();
	const [secret, setSecret] = useState("");
	const [values, setValues] = useState<Record<string, string>>(entry.values);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const run = async (action: () => Promise<void>) => {
		setBusy(true);
		setError(null);
		try {
			await action();
			setSecret("");
			onChanged();
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure));
		} finally {
			setBusy(false);
		}
	};
	const { pluginId, slot } = entry;
	const save = () =>
		run(() =>
			getPi().savePluginCredential({
				pluginId,
				slot,
				secret,
				fields: Object.fromEntries(entry.fields.map((name) => [name, values[name] ?? ""])),
			}),
		);

	return (
		<div className="rounded-xl bg-surface p-3 shadow-soft">
			<div className="flex items-center gap-2">
				<span className={`h-2 w-2 shrink-0 rounded-full ${entry.configured ? "bg-ok" : "bg-ink-faint"}`} />
				<span className="truncate text-[13px] font-medium text-ink">{entry.label[language]}</span>
				<span className="ml-auto shrink-0 text-[11px] text-ink-faint">
					{entry.configured
						? t("settings.uiPlugins.credentialConfigured")
						: t("settings.uiPlugins.credentialMissing")}
				</span>
			</div>
			<div className="mt-0.5 truncate pl-4 text-[11px] text-ink-faint">
				<span className="font-mono">{pluginId}</span> · {t("settings.uiPlugins.credentialHosts")}{" "}
				{entry.hosts.join(", ")}
			</div>
			<div className="mt-2 flex flex-col gap-2 pl-4">
				{entry.fields.map((name) => (
					<input
						key={name}
						className={inputClass}
						aria-label={name}
						placeholder={name}
						value={values[name] ?? ""}
						onChange={(e) => setValues({ ...values, [name]: e.target.value })}
					/>
				))}
				<input
					type="password"
					className={inputClass}
					aria-label={t("settings.uiPlugins.credentialSecret")}
					placeholder={
						entry.configured
							? t("settings.uiPlugins.credentialSecretReplace")
							: t("settings.uiPlugins.credentialSecret")
					}
					value={secret}
					onChange={(e) => setSecret(e.target.value)}
				/>
				{error && <p className="text-[11px] text-err">{error}</p>}
				<div className="flex justify-end gap-2">
					{entry.configured && (
						<button
							type="button"
							className="rounded-lg px-3 py-2 text-[12px] text-ink-dim transition-colors hover:bg-hover"
							disabled={busy}
							onClick={() => void run(() => getPi().clearPluginCredential({ pluginId, slot }))}
						>
							{t("settings.uiPlugins.credentialClear")}
						</button>
					)}
					<button
						type="button"
						className="rounded-full bg-ink px-3 py-2 text-[12px] font-medium text-on-ink transition-colors hover:bg-ink-2 disabled:opacity-40"
						disabled={busy || !secret.trim()}
						onClick={() => void save()}
					>
						{t("common.save")}
					</button>
				</div>
			</div>
		</div>
	);
}

/** Secrets the host keeps for managed plugins and adds to their network requests; plugins never see them. */
export function PluginCredentialsSection() {
	const t = useT();
	const [entries, setEntries] = useState<PluginCredentialEntry[]>([]);
	const load = useCallback(() => {
		void getPi()
			.listPluginCredentials()
			.then(setEntries, () => setEntries([]));
	}, []);
	useEffect(load, [load]);

	if (entries.length === 0) return null;
	return (
		<div>
			<h3 className="text-[13px] font-medium text-ink">{t("settings.uiPlugins.credentialsTitle")}</h3>
			<p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
				{t("settings.uiPlugins.credentialsHint")}
			</p>
			<div className="mt-2 flex flex-col gap-2">
				{entries.map((entry) => (
					<CredentialRow
						key={`${entry.pluginId}\t${entry.slot}\t${entry.configured}`}
						entry={entry}
						onChanged={load}
					/>
				))}
			</div>
		</div>
	);
}
