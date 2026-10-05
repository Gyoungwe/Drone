import type { PermissionRequest } from "@drone/shared";
import { t } from "../i18n";
import { ShieldIcon } from "./icons";

/**
 * 权限卡。局域网观察页始终只读，只显示等待提示；权限裁决留在桌面端。
 * UX v2：琥珀渐变描边卡 + 盾牌图标块 + message 整块等宽呈现（不做语法识别；
 * 全量展示不换行截断——消息可读性是功能语义，优先于设计稿的单行省略）。
 */
export function PermissionCard({ request }: { request: PermissionRequest }) {
	return (
		<div className="perm-card2">
			<div className="perm-head">
				<span className="perm-ic">
					<ShieldIcon size={16} />
				</span>
				<div>
					<div className="perm-title">{request.title}</div>
					<div className="perm-sub">{t("perm.subtitle")}</div>
				</div>
				<span className="pulse-dot amber" style={{ marginLeft: "auto" }} />
			</div>
			<div className="perm-cmd">{request.message}</div>
			<div className="perm-waiting">{t("perm.waiting")}</div>
		</div>
	);
}
