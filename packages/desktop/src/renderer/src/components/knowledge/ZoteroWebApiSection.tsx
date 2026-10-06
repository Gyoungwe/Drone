import type { ZoteroWebApiStatus } from "@drone/shared";
import { useCallback, useEffect, useState } from "react";
import { getPi } from "../../api";
import { Button } from "../ui/Button";
import { useZoteroText } from "./zotero-copy";

/** 设置 › Zotero › 网页 API：保存写权限密钥，让 Agent 能把已有条目归入分类、挂 PDF */
export function ZoteroWebApiSection() {
	const t = useZoteroText();
	const [status, setStatus] = useState<ZoteroWebApiStatus | null>(null);
	const [apiKey, setApiKey] = useState("");
	const [groupId, setGroupId] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		try {
			setStatus(await getPi().getZoteroWebApi());
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	}, []);
	useEffect(() => {
		void refresh();
	}, [refresh]);

	const act = async (operation: () => Promise<ZoteroWebApiStatus>, done?: string) => {
		setBusy(true);
		setError(null);
		setNotice(null);
		try {
			setStatus(await operation());
			setApiKey("");
			if (done) setNotice(done);
		} catch (e) {
			setError(
				(e instanceof Error ? e.message : String(e)).replace(
					/^Error invoking remote method '[^']+': (Error: )?/,
					"",
				),
			);
		} finally {
			setBusy(false);
		}
	};

	const library =
		status?.libraryType === "groups"
			? `group ${status.libraryId}`
			: status?.username || status?.libraryId || "";
	return (
		<section className="space-y-2 rounded-xl border border-border p-3" data-testid="zotero-web-api">
			<h4 className="text-xs font-semibold">{t("webTitle")}</h4>
			<p className="text-[11px] leading-relaxed text-ink-dim">{t("webHint")}</p>
			{status?.source === "env" ? (
				<p className="text-[11px] text-ok">{t("webFromEnv").replace("{hint}", status.keyHint ?? "")}</p>
			) : status?.configured ? (
				<div className="flex flex-wrap items-center gap-2">
					<p className="flex-1 text-[11px] text-ok">
						{t("webConfigured")
							.replace("{library}", library)
							.replace("{hint}", status.keyHint ?? "")}
					</p>
					<Button size="sm" disabled={busy} onClick={() => void act(() => getPi().clearZoteroWebApi())}>
						{t("webClear")}
					</Button>
				</div>
			) : (
				<>
					<p className="text-[11px] text-warn">{t("webNotConfigured")}</p>
					<p className="text-[11px] leading-relaxed text-ink-faint">{t("webSteps")}</p>
					<label className="block text-[11px] text-ink-dim">
						{t("webKeyLabel")}
						<input
							type="password"
							autoComplete="off"
							spellCheck={false}
							className="mt-1 w-full rounded-md border border-border bg-transparent px-2 py-1 font-mono text-xs"
							placeholder={t("webKeyPlaceholder")}
							value={apiKey}
							onChange={(event) => setApiKey(event.target.value)}
						/>
					</label>
					<label className="block text-[11px] text-ink-dim">
						{t("webGroupLabel")}
						<input
							inputMode="numeric"
							className="mt-1 w-full rounded-md border border-border bg-transparent px-2 py-1 font-mono text-xs"
							value={groupId}
							onChange={(event) => setGroupId(event.target.value.replace(/\D/g, ""))}
						/>
					</label>
					<Button
						size="sm"
						disabled={busy || apiKey.trim().length < 16}
						onClick={() =>
							void act(
								() =>
									getPi().saveZoteroWebApi(
										groupId
											? { apiKey: apiKey.trim(), libraryType: "groups", libraryId: groupId }
											: { apiKey: apiKey.trim() },
									),
								t("webSaved"),
							)
						}
					>
						{busy ? t("loading") : t("webSave")}
					</Button>
				</>
			)}
			{notice && <p className="text-[11px] text-ok">{notice}</p>}
			{error && (
				<p role="alert" className="break-words text-[11px] text-err">
					{error}
				</p>
			)}
		</section>
	);
}
