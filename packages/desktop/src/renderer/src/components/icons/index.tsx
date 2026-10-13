import {
	Add01Icon,
	Alert02Icon,
	AlertCircleIcon,
	ArrowDown01Icon,
	ArrowRight01Icon,
	ArrowUp01Icon,
	Cancel01Icon,
	CheckmarkCircle02Icon,
	CircleIcon,
	Clock01Icon,
	Coffee01Icon,
	Copy01Icon,
	Delete02Icon,
	Download01Icon,
	Edit02Icon,
	Folder01Icon,
	GitCompareIcon,
	GitForkIcon,
	HelpCircleIcon,
	CopyCheckIcon as HiCopyCheck,
	PuzzleIcon as HiPuzzle,
	LayoutLeftIcon,
	LayoutRightIcon,
	Login01Icon,
	Menu01Icon,
	PencilEdit02Icon,
	Refresh01Icon,
	Search01Icon,
	SentIcon,
	Settings01Icon,
	Shield01Icon,
	TaskDaily01Icon,
	TestTube01Icon,
	Tick02Icon,
	Undo02Icon,
	UserGroupIcon,
	WorkflowSquare01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

/**
 * 图标薄封装（U3）：统一用 Hugeicons 免费集（MIT，见 @hugeicons/core-free-icons LICENSE.md）线性图标，
 * stroke 1.5。导出名保持不变，调用方无需改动；品牌图标（Obsidian/Zotero）、实心停止键与 todo 转圈仍自绘。
 */

interface IconProps {
	size?: number;
	className?: string;
}

/** Hugeicons 统一入口：stroke 1.5、aria-hidden、颜色跟随 currentColor */
function Hi({ icon, size, className }: { icon: IconSvgElement; size: number; className?: string }) {
	return (
		<HugeiconsIcon
			icon={icon}
			size={size}
			strokeWidth={1.5}
			color="currentColor"
			className={className}
			aria-hidden="true"
		/>
	);
}

/** 错误包「！」：（报错卡片 glyph，severity 着色由使用方 text-err/warn/info 控制） */
export function ErrorCircleIcon({ size = 14, className }: IconProps) {
	return <Hi icon={AlertCircleIcon} size={size} className={className} />;
}

/** 盾牌（权限模式默认档 glyph） */
export function ShieldIcon({ size = 14, className }: IconProps) {
	return <Hi icon={Shield01Icon} size={size} className={className} />;
}

/** 警告三角（权限模式 fullAccess 档 glyph，warn 色常驻提醒） */
export function WarningIcon({ size = 14, className }: IconProps) {
	return <Hi icon={Alert02Icon} size={size} className={className} />;
}

/** 右箭头（错误卡展开 chevron） */
export function ChevronRightIcon({ size = 12, className }: IconProps) {
	return <Hi icon={ArrowRight01Icon} size={size} className={className} />;
}

/** 复制（详情复制） */
export function CopyIcon({ size = 12, className }: IconProps) {
	return <Hi icon={Copy01Icon} size={size} className={className} />;
}

/** 复制（消息操作行，14px 完整形状；与详情复制 CopyIcon 路径不同，保持原样） */
export function CopyActionIcon({ size = 14, className }: IconProps) {
	return <Hi icon={Copy01Icon} size={size} className={className} />;
}

/** 复制成功对勾（消息操作行复制态，14px，着色由使用方 text-ok 控制） */
export function CopyCheckIcon({ size = 14, className }: IconProps) {
	return <Hi icon={HiCopyCheck} size={size} className={className} />;
}

/** 子代理（隔离会话 / 小机器人） */
export function SubagentIcon({ size = 12, className }: IconProps) {
	return <Hi icon={UserGroupIcon} size={size} className={className} />;
}

/** 插件贡献的导航视图（rail.view，挂钩 4）：拼图块 */
export function PuzzleIcon({ size = 15, className }: IconProps) {
	return <Hi icon={HiPuzzle} size={size} className={className} />;
}

/** 项目总览（顶栏切换项目管理页）：田字格（右上格为斜置方块）；设计稿 .local/design/icons/menu.svg */
export function ProjectsIcon({ size = 15, className }: IconProps) {
	return <Hi icon={Folder01Icon} size={size} className={className} />;
}

/** 关闭/删除（×） */
export function CloseIcon({ size = 10, className }: IconProps) {
	return <Hi icon={Cancel01Icon} size={size} className={className} />;
}

/** 日常空间标识：咖啡杯（闲聊/探索空间；白底黑字使用，与项目条目的黑底字母反相） */
export function CoffeeIcon({ size = 14, className }: IconProps) {
	return <Hi icon={Coffee01Icon} size={size} className={className} />;
}

/** codex 风格「新会话」编辑图标 */
export function ComposeIcon({ size = 14, className }: IconProps) {
	return <Hi icon={PencilEdit02Icon} size={size} className={className} />;
}

/** Diff 侧栏开关（右栏面板图形；字形占满 viewBox，与新会话铅笔视觉同尺寸） */
export function DiffIcon({ size = 15, className }: IconProps) {
	return <Hi icon={GitCompareIcon} size={size} className={className} />;
}
/** 任务工作台：列表条目 + 进度感（纯 rect/line，避开 path 语法风险） */
export function TaskBoardIcon({ size = 15, className }: IconProps) {
	return <Hi icon={TaskDaily01Icon} size={size} className={className} />;
}

/** 加号 */
export function PlusIcon({ size = 14, className }: IconProps) {
	return <Hi icon={Add01Icon} size={size} className={className} />;
}

/** 齿轮（设置） */
export function GearIcon({ size = 14, className }: IconProps) {
	return <Hi icon={Settings01Icon} size={size} className={className} />;
}

/** 帮助（问号圆圈） */
export function HelpIcon({ size = 14, className }: IconProps) {
	return <Hi icon={HelpCircleIcon} size={size} className={className} />;
}

/** 搜索放大镜 */
export function SearchIcon({ size = 13, className }: IconProps) {
	return <Hi icon={Search01Icon} size={size} className={className} />;
}

/** 发送（纸飞机） */
export function SendIcon({ size = 12, className }: IconProps) {
	return <Hi icon={SentIcon} size={size} className={className} />;
}

/** 发送（向上箭头，来自 assets/icons/up_arrow.svg） */
export function ArrowUpIcon({ size = 14, className }: IconProps) {
	return <Hi icon={ArrowUp01Icon} size={size} className={className} />;
}

/** 撤销/取回（回卷箭头，描边镂空） */
export function UndoIcon({ size = 14, className }: IconProps) {
	return <Hi icon={Undo02Icon} size={size} className={className} />;
}

/** 停止（方块） */
export function StopIcon({ size = 10, className }: IconProps) {
	return (
		<svg
			className={className}
			width={size}
			height={size}
			viewBox="0 0 10 10"
			fill="currentColor"
			aria-hidden="true"
		>
			<rect x="0" y="0" width="10" height="10" rx="1.5" />
		</svg>
	);
}

/** 下拉箭头 */
export function ChevronDownIcon({ size = 10, className }: IconProps) {
	return <Hi icon={ArrowDown01Icon} size={size} className={className} />;
}

/** 展开箭头（来自 assets/icons/expand.svg）：默认朝右，展开时 rotate-90 朝下 */
export function ExpandArrowIcon({ size = 10, className }: IconProps) {
	return <Hi icon={ArrowRight01Icon} size={size} className={className} />;
}

/** 勾选 */
export function CheckIcon({ size = 12, className }: IconProps) {
	return <Hi icon={Tick02Icon} size={size} className={className} />;
}

/** todo 待办：细线空心圆环（描边风，淡雅灰系由使用方 text-* 控制） */
export function TodoPendingIcon({ size = 14, className }: IconProps) {
	return <Hi icon={CircleIcon} size={size} className={className} />;
}

/** todo 已完成：对勾描边绘制动画（todo-check-path 类见 globals.css，仅新挂载行触发） */
export function TodoCompleteIcon({ size = 14, className }: IconProps) {
	return <Hi icon={CheckmarkCircle02Icon} size={size} className={className} />;
}

/** todo 进行中：弧线转圈（animate-spin 由使用方控制，颜色淡雅灰系） */
export function TodoSpinnerIcon({ size = 14, className }: IconProps) {
	return (
		<svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
			<circle
				cx="8"
				cy="8"
				r="6"
				stroke="currentColor"
				strokeWidth="1.8"
				strokeDasharray="26 12"
				strokeLinecap="round"
			/>
		</svg>
	);
}

/** 仪表盘（测试连接，外部下载 cesu.svg，1024 实心填充） */
export function TestIcon({ size = 13, className }: IconProps) {
	return <Hi icon={TestTube01Icon} size={size} className={className} />;
}

/** 编辑框（配置/更新 Key，外部下载 edit.svg，1024 实心填充） */
export function EditIcon({ size = 13, className }: IconProps) {
	return <Hi icon={Edit02Icon} size={size} className={className} />;
}

/** 刷新（循环箭头，设置页联网刷新模型目录） */
export function RefreshIcon({ size = 13, className }: IconProps) {
	return <Hi icon={Refresh01Icon} size={size} className={className} />;
}

/** 垃圾桶（删除/移除凭证） */
export function TrashIcon({ size = 13, className }: IconProps) {
	return <Hi icon={Delete02Icon} size={size} className={className} />;
}

/** 文件夹（打开目录） */
export function FolderIcon({ size = 13, className }: IconProps) {
	return <Hi icon={Folder01Icon} size={size} className={className} />;
}

/** 下载（顶栏更新按钮 / 更新进度环内图标） */
export function DownloadIcon({ size = 14, className }: IconProps) {
	return <Hi icon={Download01Icon} size={size} className={className} />;
}

/** 分叉（assistant 消息操作行，外部下载 fork.svg，1024 实心填充；path 与 .local/design/icons/fork.svg 原件逐字符一致，strokeWidth 20 为加粗调整） */
export function ForkIcon({ size = 16, className }: IconProps) {
	return <Hi icon={GitForkIcon} size={size} className={className} />;
}

/** 订阅登录（provider OAuth 入口，lucide log-in 风格） */
export function LoginIcon({ size = 13, className }: IconProps) {
	return <Hi icon={Login01Icon} size={size} className={className} />;
}

/** 时钟（轮末计时 glyph，lucide clock 风格） */
export function ClockIcon({ size = 12, className }: IconProps) {
	return <Hi icon={Clock01Icon} size={size} className={className} />;
}

/** Faceted crystal shortcut for the Obsidian knowledge workspace. */
export function ObsidianIcon({ size = 16, className }: IconProps) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
			<path fill="currentColor" d="M14 2 5 7 3 16l6 6 10-4 2-10z" />
			<path fill="white" opacity=".24" d="m14 2-5 8 10 8 2-10z" />
			<path fill="white" opacity=".4" d="m9 10-4-3-2 9 6 6z" />
		</svg>
	);
}

/** Rounded-square "Z" shortcut for the Zotero literature library. */
export function ZoteroIcon({ size = 16, className }: IconProps) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
			<rect x="3" y="3" width="18" height="18" rx="4" fill="currentColor" />
			<path fill="white" d="M8 7h8v1.8l-5.1 6.4H16V17H8v-1.8l5.1-6.4H8z" />
		</svg>
	);
}

/** 右侧面板开关（lucide panel-right 风格）：顶栏 ⇥ 按钮与面板头共用 */
export function PanelRightIcon({ size = 14, className }: IconProps) {
	return <Hi icon={LayoutRightIcon} size={size} className={className} />;
}

/** 侧栏收起 / 展开 glyph */
export function PanelLeftIcon({ size = 14, className }: IconProps) {
	return <Hi icon={LayoutLeftIcon} size={size} className={className} />;
}

/** 过程/时间线 glyph（面板「过程」页签） */
export function TimelineIcon({ size = 14, className }: IconProps) {
	return <Hi icon={WorkflowSquare01Icon} size={size} className={className} />;
}

/** 会话列表（顶栏溢出菜单） */
export function ListIcon({ size = 14, className }: IconProps) {
	return <Hi icon={Menu01Icon} size={size} className={className} />;
}
