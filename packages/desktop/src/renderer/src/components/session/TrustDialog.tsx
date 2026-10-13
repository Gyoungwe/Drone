import type { TrustOption, TrustRequest } from "@drone/shared";
import { useT } from "../../i18n";
import { ActionSurface } from "../ui/ActionSurface";
import { Button } from "../ui/Button";

/** 项目信任对话框：添加项目/创建会话前确认是否加载项目本地资源（.pi/ 扩展、skills 等） */
export function TrustDialog({
	requests,
	onRespond,
}: {
	requests: TrustRequest[];
	onRespond: (requestId: string, optionIndex: number) => void;
}) {
	const t = useT();
	const request = requests[0];
	if (!request) return null;

	const label = (option: TrustOption): string => {
		switch (option.key) {
			case "trust":
				return t("trust.trust");
			case "deny":
				return t("trust.deny");
		}
	};

	return (
		<ActionSurface
			ariaLabel={t("trust.title")}
			tone="warn"
			width="compact"
			height="fit"
			testId="trust-dialog"
		>
			<div className="px-5 pt-5 pb-4">
				<span className="inline-flex items-center rounded-full bg-warn/12 px-2 py-0.5 text-xs font-medium text-warn">
					{t("trust.eyebrow")}
				</span>
				<h3 className="mt-2 text-[15px] font-semibold text-ink">{t("trust.title")}</h3>
				<p className="mt-2 rounded-lg border border-border bg-canvas px-3 py-2 font-mono text-[12px] break-all text-ink-2 select-text">
					{request.cwd}
				</p>
				<p className="mt-3 text-[12.5px] leading-relaxed text-ink-2">{t("trust.message")}</p>
			</div>
			<div className="flex items-center justify-between gap-3 border-t border-border bg-canvas/60 px-5 py-3">
				<span className="min-w-0 truncate text-[11px] text-ink-faint">
					{requests.length > 1 ? t("trust.queued", { count: requests.length - 1 }) : ""}
				</span>
				<div className="flex shrink-0 gap-2">
					{[...request.options.keys()]
						.sort(
							(a, b) =>
								(request.options[a]?.key === "trust" ? 1 : 0) - (request.options[b]?.key === "trust" ? 1 : 0),
						)
						.map((index) => {
							const option = request.options[index] as TrustOption;
							return (
								<Button
									key={option.key}
									variant={option.key === "trust" ? "primary" : "ghost"}
									tone={option.key.startsWith("deny") ? "danger" : "default"}
									className="min-h-9 px-4"
									onClick={() => onRespond(request.id, index)}
								>
									{label(option)}
								</Button>
							);
						})}
				</div>
			</div>
		</ActionSurface>
	);
}
