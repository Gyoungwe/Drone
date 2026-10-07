import { useEffect, useRef, useState } from "react";
import { useThemeStore } from "../../stores/theme";
import { drawCenterOrb } from "./center-orb-draw";

/**
 * 放大状态动画（centerOrbEnabled 开关只控制本组件；MetaGroup 状态行小 orb 解耦、恒显示）。
 *
 * 绘制 = 神经流（center-orb-draw.ts，playground 定稿：.local/design/components/center-status-anim/）：
 * 粒子沿内外轨道带对转流转，亮度波/放电点亮突触细线，信号脉冲沿连接线流动。
 * 两态已合一为中速单动画（用户反馈 thinking/working 双态交叉淡化切换不自然）——
 * 无状态切换即无硬切，显隐只有一层非对称淡入淡出（单 canvas 即可，无需层栈）。
 *
 * 布局：文档流内的独立块，由 MessageList 放在对话内容末尾（最新消息 / Thinking 行下方）、水平居中。
 * 原实现是 absolute inset-0 + z-20 盖在整个消息滚动区正中——画在视口中央而非当前轮次处，
 * 历史长的会话里粒子直接压在旧消息文字上（canvas 自带的同色遮罩圆盘只有 0.72 不透明度、
 * 且日间遮罩色 #fafafa 与 canvas 底 #ffffff 不一致，压不住文字反而像一团脏点）。
 * 现在动画有自己的占位：高度随显隐一起展开/收起（不跳动），不与任何文字重叠，也就不再需要遮罩。
 */
/** 基准边长（绘制的逻辑空间边长，非显示尺寸；绘制内部按比例设计） */
const BASE = 64;
/** 显示不透明度：全量呈现哑光灰阶设计，不压暗 */
const ORB_OPACITY = 1;
/** 边长 = 内容列宽 × RATIO，夹在 [MIN_PX, MAX_PX]：在流内占位，比原全屏覆盖版小，仍比状态行小 orb 醒目 */
const RATIO = 0.2;
const MIN_PX = 96;
const MAX_PX = 152;
/** 显隐淡入淡出：非对称（Material 式减速入场/加速离场），入场叠 scale 0.94→1 聚拢感 */
const FADE_IN_MS = 650;
const FADE_OUT_MS = 300;

export function CenterOrb({ visible }: { visible: boolean }) {
	const wrapRef = useRef<HTMLDivElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [px, setPx] = useState(0);
	const [mounted, setMounted] = useState(false);
	const [on, setOn] = useState(false);
	const dark = useThemeStore((s) => s.resolved) === "dark";

	// 显隐驱动：visible → 挂载 + 下一帧点亮（首帧 opacity 0 走 transition 淡入）；
	// !visible → 立即淡出，FADE_OUT_MS 后卸载（停 rAF、释放 canvas）
	useEffect(() => {
		if (visible) {
			setMounted(true);
			const raf = requestAnimationFrame(() => setOn(true));
			return () => cancelAnimationFrame(raf);
		}
		setOn(false);
		const timer = setTimeout(() => setMounted(false), FADE_OUT_MS);
		return () => clearTimeout(timer);
	}, [visible]);

	// 内容列宽 → 边长（列宽的 RATIO，夹取上下限）；挂载后才能测量，mounted 变化时重跑
	useEffect(() => {
		const wrap = wrapRef.current;
		if (!wrap || !mounted) return;
		const measure = () => {
			const { width } = wrap.getBoundingClientRect();
			setPx(Math.round(Math.min(MAX_PX, Math.max(MIN_PX, width * RATIO))));
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(wrap);
		return () => observer.disconnect();
	}, [mounted]);

	// canvas.width 赋值会清空位图 → 只在尺寸变化时做
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas || px <= 0 || !mounted) return;
		const dpr = Math.min(2, window.devicePixelRatio || 1);
		canvas.width = Math.round(px * dpr);
		canvas.height = Math.round(px * dpr);
	}, [px, mounted]);

	// 渲染循环：dpr 封顶 2；reduced-motion 画静态帧 t=0.6；
	// 尺寸差异吸收进 ctx 变换（k = dpr × 显示边长 / 基准边长），draw 永远按 64 逻辑尺寸作画
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas || px <= 0 || !mounted) return;
		const ctx = canvas.getContext("2d");
		if (!ctx || canvas.width === 0) return;
		const k = canvas.width / BASE;
		const paint = (t: number) => {
			ctx.setTransform(k, 0, 0, k, 0, 0);
			ctx.clearRect(0, 0, BASE, BASE);
			drawCenterOrb(ctx, BASE, t, dark, { mask: false });
		};
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			paint(0.6);
			return;
		}
		let raf = 0;
		const tick = () => {
			paint(performance.now() / 1000);
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [dark, px, mounted]);

	if (!mounted) return null;
	const shown = on && px > 0;
	return (
		<div
			ref={wrapRef}
			className="pointer-events-none flex w-full shrink-0 items-start justify-center overflow-hidden"
			style={{
				// 流内占位：高度与透明度同步展开/收起，出现与消失都不让上方内容跳动
				height: shown ? px : 0,
				transitionProperty: "height",
				transitionDuration: on ? `${FADE_IN_MS}ms` : `${FADE_OUT_MS}ms`,
				transitionTimingFunction: on ? "ease-out" : "ease-in",
			}}
			aria-hidden="true"
			data-testid="center-orb"
		>
			{px > 0 && (
				<div
					className="relative shrink-0"
					style={{
						width: px,
						height: px,
						opacity: shown ? ORB_OPACITY : 0,
						transform: shown ? "scale(1)" : "scale(0.94)",
						transitionProperty: "opacity, transform",
						transitionDuration: on ? `${FADE_IN_MS}ms` : `${FADE_OUT_MS}ms`,
						transitionTimingFunction: on ? "ease-out" : "ease-in",
					}}
				>
					<canvas ref={canvasRef} className="absolute inset-0" style={{ width: px, height: px }} />
				</div>
			)}
		</div>
	);
}
