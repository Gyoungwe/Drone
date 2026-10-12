import { fileTypeOf, type PreviewKind, type ResourcePreviewResult } from "@drone/shared";
import type { ComponentType } from "react";

/** 一个预览器拿到的输入：主进程预览结果 + 解好的 data URL。 */
export interface PreviewRendererProps {
	result: ResourcePreviewResult;
	src: string | null;
}
export type PreviewRenderer = ComponentType<PreviewRendererProps>;

const renderers = new Map<PreviewKind, PreviewRenderer>();

/** 预览器按 previewKind 注册（P3/P4 的新预览器在各自模块里调用）。 */
export function registerPreviewRenderer(kind: PreviewKind, renderer: PreviewRenderer): void {
	renderers.set(kind, renderer);
}
export function previewRendererFor(kind: PreviewKind): PreviewRenderer | undefined {
	return renderers.get(kind);
}

export type PreviewRoute =
	| { view: "registered"; kind: PreviewKind }
	| { view: "image" }
	| { view: "pdf" }
	| { view: "text" }
	| { view: "binary" }
	| { view: "too-large" };

export function previewKindOf(result: ResourcePreviewResult): PreviewKind {
	return result.previewKind ?? fileTypeOf(result.name).previewKind;
}

/** 预览 / 源码双页签：只要拿到了文本就能看源码。 */
export function hasSourceTab(result: ResourcePreviewResult): boolean {
	return result.text !== undefined;
}

/** 纯函数路由：决定 PreviewHost 用哪个视图，方便单测每种 kind。 */
export function routePreview(result: ResourcePreviewResult, hasSrc: boolean): PreviewRoute {
	const kind = previewKindOf(result);
	if (renderers.has(kind)) return { view: "registered", kind };
	if (result.kind === "image") return hasSrc ? { view: "image" } : { view: "too-large" };
	if (result.kind === "pdf") return hasSrc ? { view: "pdf" } : { view: "too-large" };
	if (result.kind === "text") return { view: "text" };
	return { view: "binary" };
}
