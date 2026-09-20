import type { InstitutionalStatus } from "@drone/shared";
import { useCallback, useEffect, useState } from "react";
import { getPi } from "../../api";
import { Button } from "../ui/Button";

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
	return (
		<div className="flex items-center justify-between gap-2 text-[11px]">
			<span className="text-ink-dim">{label}</span>
			<span className={`truncate ${ok === true ? "text-ok" : ok === false ? "text-warn" : "text-ink"}`}>
				{value}
			</span>
		</div>
	);
}

export function InstitutionalAccessSection() {
	const [status, setStatus] = useState<InstitutionalStatus | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [testUrl, setTestUrl] = useState("https://doi.org/10.1038/nature12373");
	const [testResult, setTestResult] = useState<string | null>(null);
	const [testing, setTesting] = useState(false);

	const refresh = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const s = await getPi().getInstitutionalStatus();
			setStatus(s);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const openLogin = async (url?: string) => {
		setError(null);
		try {
			await getPi().openInstitutionalLogin(url);
			setTimeout(() => void refresh(), 1500);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	};

	const clear = async () => {
		setError(null);
		try {
			const next = await getPi().clearInstitutionalSession();
			setStatus(next);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	};

	const doTest = async () => {
		setTesting(true);
		setTestResult(null);
		setError(null);
		try {
			const res = await getPi().testInstitutionalAccess(testUrl);
			setTestResult(JSON.stringify(res, null, 2));
			await refresh();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setTesting(false);
		}
	};

	return (
		<section className="rounded-xl border border-border p-4" data-testid="institutional-section">
			<h3 className="text-xs font-semibold">机构访问（一次登录，自动保存模板）</h3>
			<p className="mt-1 text-[11px] leading-relaxed text-ink-dim">
				Agent
				在归档文献时若遇到付费墙，会自动请求机构登录。点“登录机构账号”后在弹出窗口完成学校/图书馆登录（支持
				EZproxy / Shibboleth / CARSI / OpenAthens / WebVPN），系统会自动从 URL 中识别并保存 EZproxy 模板（例如
				.../login?url=%s），无需手动填写。登录态保存在持久分区，重启仍有效。任务授权后会自动尝试下载（每任务最多{" "}
				{status?.config.perTaskLimit ?? 20} 篇），仅在过期或验证码时再次弹窗。
			</p>

			{error && (
				<p
					role="alert"
					className="mt-3 break-words rounded-lg border border-border bg-err/10 p-2 text-[11px] text-err"
				>
					{error}
				</p>
			)}

			{status && (
				<div className="mt-3 grid gap-1.5 rounded-lg bg-hover p-2">
					<Row label="登录状态" value={status.loggedIn ? "已登录" : "未登录"} ok={status.loggedIn} />
					<Row
						label="Cookie 数"
						value={`${status.session.cookiesCount}`}
						ok={status.session.cookiesCount > 0}
					/>
					<Row
						label="上次登录"
						value={status.config.lastLoginAt ? new Date(status.config.lastLoginAt).toLocaleString() : "从未"}
					/>
					<Row
						label="自动模板"
						value={status.config.ezproxyTemplate || "未自动识别（直连会话）"}
						ok={Boolean(status.config.ezproxyTemplate)}
					/>
					<Row label="机构名" value={status.config.institutionName || "未填"} />
					<Row
						label="自动下载"
						value={status.config.autoDownloadEnabled ? "开启" : "关闭"}
						ok={status.config.autoDownloadEnabled}
					/>
					<Row label="每任务上限" value={`${status.config.perTaskLimit} 篇`} />
				</div>
			)}

			<div className="mt-4 space-y-3">
				<div className="flex flex-wrap gap-1.5">
					<Button size="sm" variant="primary" onClick={() => void openLogin()}>
						登录机构账号（自动保存模板）
					</Button>
					<Button size="sm" disabled={loading} onClick={() => void refresh()}>
						刷新状态
					</Button>
					<Button size="sm" onClick={() => void clear()}>
						清除登录状态
					</Button>
				</div>

				<div className="rounded-lg border border-dashed border-border p-2">
					<div className="text-[11px] font-medium text-ink">测试访问（经机构会话/自动模板尝试）</div>
					<div className="mt-1 flex gap-1">
						<input
							className="flex-1 rounded-lg border border-border bg-surface px-2 py-1 text-xs"
							value={testUrl}
							onChange={(e) => setTestUrl(e.target.value)}
							placeholder="https://doi.org/..."
						/>
						<Button size="sm" disabled={testing} onClick={() => void doTest()}>
							{testing ? "测试中…" : "测试"}
						</Button>
					</div>
					{testResult && (
						<pre className="mt-2 max-h-48 overflow-auto rounded bg-hover p-2 text-[10px] leading-relaxed">
							{testResult}
						</pre>
					)}
					<p className="mt-2 text-[10px] leading-relaxed text-ink-faint">
						工作流：Agent 调用 research_archive_source → OA 失败 → 返回 institutional_auth_required → Agent
						自动调用 research_institutional_login 打开窗口 → 你登录 → 系统自动识别模板（如
						https://ezproxy.xxx.edu/login?url=%s）并保存到 ~/.pi/agent/institutional.json →
						重试下载。不需要手动设置模板。
					</p>
				</div>

				<p className="text-[10px] text-ink-faint">
					提示：若你的学校使用 WebVPN（如
					https://webvpn.xxx.edu.cn/https/443/www.nature.com/...），直接登录即可，无需模板，系统靠持久 Cookie
					直连。EZproxy 会自动保存，下次无需再登录。
				</p>
			</div>
		</section>
	);
}
