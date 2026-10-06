import type { ZoteroLocalWriteStatus } from "@drone/shared";
import { useCallback, useEffect, useState } from "react";
import { getPi } from "../../api";
import { Button } from "../ui/Button";
import { useZoteroText } from "./zotero-copy";

/** 校验失败时 IPC 返回错误信封（无 authorized 字段），不能当作状态 */
export function isZoteroLocalWriteStatus(value: unknown): value is ZoteroLocalWriteStatus {
	return typeof (value as Partial<ZoteroLocalWriteStatus> | null)?.authorized === "boolean";
}

/** 当前状态对应的说明文案 key */
export function localWriteStateKey(
	status: ZoteroLocalWriteStatus,
):
	| "localUnreachable"
	| "localUnsupported"
	| "localStale"
	| "localFromEnv"
	| "localAuthorized"
	| "localNotAuthorized" {
	if (!status.reachable) return "localUnreachable";
	if (status.supported === false) return "localUnsupported";
	if (status.staleServer) return "localStale";
	if (status.authorized) return status.source === "env" ? "localFromEnv" : "localAuthorized";
	return "localNotAuthorized";
}

/** 设置 › Zotero › 本机写入（Zotero 10+）：Zotero 弹窗授权一次，Agent 在本机修改已有条目 */
export function ZoteroLocalWriteSection() {
	const t = useZoteroText();
	const [status, setStatus] = useState<ZoteroLocalWriteStatus | null>(null);
	const [busy, setBusy] = useState<"authorize" | "clear" | null>(null);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		try {
			const next = await getPi().getZoteroLocalWrite();
			if (isZoteroLocalWriteStatus(next)) setStatus(next);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	}, []);
	useEffect(() => {
		void refresh();
	}, [refresh]);

	const act = async (kind: "authorize" | "clear", operation: () => Promise<ZoteroLocalWriteStatus>) => {
		setBusy(kind);
		setError(null);
		try {
			const next = await operation();
			if (isZoteroLocalWriteStatus(next)) setStatus(next);
		} catch (e) {
			setError(
				(e instanceof Error ? e.message : String(e)).replace(
					/^Error invoking remote method '[^']+': (Error: )?/,
					"",
				),
			);
		} finally {
			setBusy(null);
		}
	};

	if (!status) return null;
	const state = localWriteStateKey(status);
	const canAuthorize = status.reachable && status.supported !== false && status.source !== "env";
	return (
		<section className="space-y-2 rounded-xl border border-border p-3" data-testid="zotero-local-write">
			<h4 className="text-xs font-semibold">{t("localTitle")}</h4>
			<p className="text-[11px] leading-relaxed text-ink-dim">{t("localHint")}</p>
			<p
				role="status"
				className={`text-[11px] ${state === "localAuthorized" || state === "localFromEnv" ? "text-ok" : "text-warn"}`}
			>
				{busy === "authorize" ? t("localAuthorizing") : t(state)}
			</p>
			<div className="flex flex-wrap gap-2">
				{canAuthorize && !status.authorized && (
					<Button
						size="sm"
						disabled={busy !== null}
						onClick={() => void act("authorize", () => getPi().authorizeZoteroLocalWrite())}
					>
						{busy === "authorize" ? t("loading") : t("localAuthorize")}
					</Button>
				)}
				{status.source === "settings" && (
					<Button
						size="sm"
						disabled={busy !== null}
						onClick={() => void act("clear", () => getPi().clearZoteroLocalWrite())}
					>
						{t("localClear")}
					</Button>
				)}
			</div>
			{status.source === "settings" && (
				<p className="text-[11px] leading-relaxed text-ink-faint">{t("localClearHint")}</p>
			)}
			{error && (
				<p role="alert" className="break-words text-[11px] text-err">
					{error}
				</p>
			)}
		</section>
	);
}
