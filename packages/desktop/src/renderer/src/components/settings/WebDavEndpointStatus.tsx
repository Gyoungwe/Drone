import type { PluginCredentialEntry } from "@drone/shared";
import { useT } from "../../i18n";

/** Read-only host endpoint metadata; invalid configuration never carries a URL. */
export function WebDavEndpointStatus({ endpoint }: { endpoint?: PluginCredentialEntry["endpoint"] }) {
	const t = useT();
	if (!endpoint) return null;
	if (endpoint.state === "invalid")
		return <p className="mt-2 pl-4 text-[11px] text-err">{t("settings.uiPlugins.webdavEndpointInvalid")}</p>;
	return (
		<div className="mt-2 pl-4 text-[11px] text-ink-dim">
			<span>{t("settings.uiPlugins.webdavEffectiveEndpoint")}</span>
			<p className="select-text break-all font-mono text-ink">{endpoint.url}</p>
			<p>
				{t(
					endpoint.source === "env"
						? "settings.uiPlugins.webdavEndpointEnv"
						: "settings.uiPlugins.webdavEndpointDefault",
				)}
			</p>
			{endpoint.url.startsWith("http:") && <p>{t("settings.uiPlugins.webdavEndpointHttpWarning")}</p>}
		</div>
	);
}
