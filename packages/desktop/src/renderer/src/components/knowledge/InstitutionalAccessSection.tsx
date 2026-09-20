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
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [ezproxyTemplate, setEzproxyTemplate] = useState("");
	const [openUrlResolver, setOpenUrlResolver] = useState("");
	const [institutionName, setInstitutionName] = useState("");
	const [autoDownloadEnabled, setAutoDownloadEnabled] = useState(true);
	const [perTaskLimit, setPerTaskLimit] = useState(20);
	const [testUrl, setTestUrl] = useState("https://doi.org/10.1038/nature12373");
	const [testResult, setTestResult] = useState<string | null>(null);
	const [testing, setTesting] = useState(false);

	const refresh = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const s = await getPi().getInstitutionalStatus();
			setStatus(s);
			setEzproxyTemplate(s.config.ezproxyTemplate || "");
			setOpenUrlResolver(s.config.openUrlResolver || "");
			setInstitutionName(s.config.institutionName || "");
			setAutoDownloadEnabled(s.config.autoDownloadEnabled);
			setPerTaskLimit(s.config.perTaskLimit);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const save = async () => {
		setSaving(true);
		setError(null);
		try {
			const next = await getPi().saveInstitutionalConfig({
				ezproxyTemplate: ezproxyTemplate.trim() || undefined,
				openUrlResolver: openUrlResolver.trim() || undefined,
				institutionName: institutionName.trim() || undefined,
				autoDownloadEnabled,
				perTaskLimit,
			});
			setStatus(next);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setSaving(false);
		}
	};

	const openLogin = async (url?: string) => {
		setError(null);
		try {
			await getPi().openInstitutionalLogin(url);
			// refresh after short delay to catch cookie
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
			<h3 className="text-xs font-semibold">机构访问（合法通道）</h3>
			<p className="mt-1 text-[11px] leading-relaxed text-ink-dim">
				通过你自己的机构账号（EZproxy / Shibboleth / CARSI / OpenAthens /
				WebVPN）获取闭源文献。登录一次后，任务授权后会自动尝试下载（每任务最多{" "}
				{status?.config.perTaskLimit ?? perTaskLimit}{" "}
				篇），仅在登录过期或遇到验证码时才弹出浏览器窗口让你处理。不走任何盗版源。
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
					<Row label="分区" value={status.session.partition} />
					<Row
						label="上次登录"
						value={status.config.lastLoginAt ? new Date(status.config.lastLoginAt).toLocaleString() : "从未"}
					/>
					<Row
						label="自动下载"
						value={status.config.autoDownloadEnabled ? "开启" : "关闭"}
						ok={status.config.autoDownloadEnabled}
					/>
					<Row label="每任务上限" value={`${status.config.perTaskLimit} 篇`} />
					<Row
						label="EZproxy"
						value={status.config.ezproxyTemplate ? "已配置" : "未配置"}
						ok={Boolean(status.config.ezproxyTemplate)}
					/>
					<Row label="OpenURL" value={status.config.openUrlResolver ? "已配置" : "未配置"} />
					<Row label="机构名" value={status.config.institutionName || "未填"} />
				</div>
			)}

			<div className="mt-4 space-y-3">
				<div>
					<div className="text-[11px] font-medium text-ink">EZproxy 模板（推荐）</div>
					<input
						className="mt-1 w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-xs"
						placeholder="https://ezproxy.example.edu/login?url=%s  或  https://ezproxy.example.edu/login?url="
						value={ezproxyTemplate}
						onChange={(e) => setEzproxyTemplate(e.target.value)}
					/>
					<p className="mt-1 text-[10px] text-ink-faint">
						支持 %s 占位符，例如 https://ezproxy.xxx.edu/login?url=%s；若不含 %s，会自动在末尾追加 url=
						编码后的目标地址。留空则仅用机构会话直连。
					</p>
				</div>
				<div>
					<div className="text-[11px] font-medium text-ink">OpenURL 解析器（可选）</div>
					<input
						className="mt-1 w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-xs"
						placeholder="https://resolver.example.edu/openurl"
						value={openUrlResolver}
						onChange={(e) => setOpenUrlResolver(e.target.value)}
					/>
				</div>
				<div>
					<div className="text-[11px] font-medium text-ink">机构显示名（可选）</div>
					<input
						className="mt-1 w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-xs"
						placeholder="例如 XX大学图书馆"
						value={institutionName}
						onChange={(e) => setInstitutionName(e.target.value)}
					/>
				</div>
				<div className="flex items-center gap-4">
					<label className="flex items-center gap-1.5 text-[11px]">
						<input
							type="checkbox"
							checked={autoDownloadEnabled}
							onChange={(e) => setAutoDownloadEnabled(e.target.checked)}
						/>
						<span>任务授权后自动下载</span>
					</label>
					<label className="flex items-center gap-1.5 text-[11px]">
						<span>每任务上限</span>
						<input
							type="number"
							min={1}
							max={100}
							className="w-16 rounded border border-border bg-surface px-1 py-0.5 text-xs"
							value={perTaskLimit}
							onChange={(e) => setPerTaskLimit(Math.min(100, Math.max(1, Number(e.target.value) || 20)))}
						/>
					</label>
				</div>

				<div className="flex flex-wrap gap-1.5">
					<Button size="sm" variant="primary" disabled={saving || loading} onClick={() => void save()}>
						{saving ? "保存中…" : "保存配置"}
					</Button>
					<Button size="sm" disabled={loading} onClick={() => void refresh()}>
						刷新状态
					</Button>
					<Button size="sm" variant="primary" onClick={() => void openLogin()}>
						登录机构账号
					</Button>
					<Button size="sm" onClick={() => void openLogin("https://www.nature.com/")}>
						打开 Nature 测试登录
					</Button>
					<Button size="sm" onClick={() => void clear()}>
						清除登录状态
					</Button>
				</div>

				<div className="rounded-lg border border-dashed border-border p-2">
					<div className="text-[11px] font-medium text-ink">测试访问（会经机构会话/EZproxy 尝试）</div>
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
					<p className="mt-1 text-[10px] text-ink-faint">
						说明：EZproxy 需先在图书馆登录一次（点“登录机构账号”后在弹出窗口完成登录，支持
						Shibboleth/CARSI/OpenAthens/WebVPN）。登录态保存在持久分区
						persist:drone-institutional，重启仍有效。任务中若返回
						institutional_auth_required，会自动提示你重新登录。
					</p>
				</div>
			</div>
		</section>
	);
}
