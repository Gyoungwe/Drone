import { useEffect, useRef } from "react";

/** 把 RGBA 像素画到 canvas（jsdom 无 2d 上下文时只保留尺寸，便于测试）。 */
export function RgbaCanvas({
	rgba,
	width,
	height,
	label,
	displayWidth,
}: {
	rgba: Uint8ClampedArray;
	width: number;
	height: number;
	label: string;
	displayWidth?: number;
}) {
	const ref = useRef<HTMLCanvasElement>(null);
	useEffect(() => {
		const ctx = ref.current?.getContext?.("2d");
		if (!ctx || typeof ImageData === "undefined") return;
		ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
	}, [rgba, width, height]);
	return (
		<canvas
			ref={ref}
			width={width}
			height={height}
			role="img"
			aria-label={label}
			className="preview-pixels"
			style={displayWidth ? { width: displayWidth, height: (displayWidth * height) / width } : undefined}
		/>
	);
}
