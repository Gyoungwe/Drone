import { skillDisplayName } from "@drone/shared";

/**
 * 输入框正文行高（px）。textarea 与行首胶囊共用这一行高：胶囊高度 = 行高、顶对齐即垂直居中于首行文字，
 * 不再依赖 leading-relaxed（14px × 1.625 = 22.75px 的小数行高在 Windows 125%/150% 缩放下取整漂移）。
 */
export const COMPOSER_LINE_PX = 22;
/** 胶囊与正文首字之间的间距（px），与胶囊之间的 gap-1.5 一致 */
export const COMPOSER_CHIP_GAP_PX = 6;
/** 行首胶囊总宽超过输入框宽度的这一比例时，改为输入框上方独立一行（避免首行只剩几个字） */
export const INLINE_CHIP_MAX_RATIO = 0.6;

export interface SlashPillView {
	/** 胶囊上显示的文字：skill 用产品名（无则裸名），其余命令显示 /name */
	label: string;
	/** 悬停提示：始终是实际发送的完整命令 */
	command: string;
	isSkill: boolean;
}

/** slash 胶囊的展示文案：只影响显示，发送仍按 `/${name}` 拼装（use-composer-send 不变） */
export function slashPillView(name: string, language: "zh" | "en"): SlashPillView {
	const isSkill = name.startsWith("skill:");
	return {
		label: isSkill ? skillDisplayName(name, language) : `/${name}`,
		command: `/${name}`,
		isSkill,
	};
}

/**
 * 行首胶囊是否内联到正文首行（textarea text-indent 让出胶囊宽度，后续行回到左边缘、像行内 token）；
 * 否则胶囊独占输入框上方一行。宽度未测得（0）时按内联处理，避免首帧闪成两行。
 */
export function chipsFitInline(chipsWidth: number, containerWidth: number): boolean {
	if (chipsWidth <= 0 || containerWidth <= 0) return true;
	return chipsWidth <= containerWidth * INLINE_CHIP_MAX_RATIO;
}

/** 内联时 textarea 首行缩进（px）：胶囊总宽 + 间距，取整避免亚像素缩进导致首字半像素模糊 */
export function chipIndentPx(chipsWidth: number): number {
	return chipsWidth > 0 ? Math.ceil(chipsWidth) + COMPOSER_CHIP_GAP_PX : 0;
}

/** 由多个胶囊各自宽度求总宽（含 gap）；与布局模式无关，避免内联/换行两态互相影响测量 */
export function chipsTotalWidth(widths: readonly number[]): number {
	const visible = widths.filter((w) => w > 0);
	if (visible.length === 0) return 0;
	return visible.reduce((sum, w) => sum + w, 0) + COMPOSER_CHIP_GAP_PX * (visible.length - 1);
}

/** 光标在正文最前（且无选区）时，Backspace 视为删除紧挨着的行首胶囊 */
export function caretAtStart(selectionStart: number | null, selectionEnd: number | null): boolean {
	return selectionStart === 0 && selectionEnd === 0;
}
