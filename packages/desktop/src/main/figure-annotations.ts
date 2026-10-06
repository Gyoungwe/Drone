import { join } from "node:path";
import { JsonStore } from "@drone/backend";
import type { FigureAnnotation } from "@drone/shared";
import { app } from "electron";

/** 图上标注：按文件绝对路径保存在 userData（不写进用户的结果目录） */
interface FigureAnnotationFile {
	version: 1;
	files: Record<string, { updatedAt: string; annotations: FigureAnnotation[] }>;
}

const MAX_FILES = 500;
const MAX_ANNOTATIONS = 200;

let store: JsonStore<FigureAnnotationFile> | null = null;

function annotationStore(): JsonStore<FigureAnnotationFile> {
	store ??= new JsonStore<FigureAnnotationFile>({
		path: join(app.getPath("userData"), "figure-annotations.json"),
		storageId: "desktop-figure-annotations",
		defaultValue: () => ({ version: 1, files: {} }),
	});
	return store;
}

function clamp(value: unknown): number {
	const number = typeof value === "number" && Number.isFinite(value) ? value : 0;
	return Math.min(1, Math.max(0, number));
}

/** 字段规整：坐标夹到 0–1、文本截断、id 去重、数量上限 */
export function normalizeAnnotations(input: unknown): FigureAnnotation[] {
	if (!Array.isArray(input)) return [];
	const seen = new Set<string>();
	const result: FigureAnnotation[] = [];
	for (const item of input) {
		if (!item || typeof item !== "object") continue;
		const raw = item as Partial<FigureAnnotation>;
		const id = typeof raw.id === "string" && raw.id ? raw.id.slice(0, 64) : "";
		if (!id || seen.has(id)) continue;
		seen.add(id);
		result.push({
			id,
			x: clamp(raw.x),
			y: clamp(raw.y),
			text: typeof raw.text === "string" ? raw.text.slice(0, 2000) : "",
			createdAt: typeof raw.createdAt === "string" ? raw.createdAt.slice(0, 64) : new Date().toISOString(),
		});
		if (result.length >= MAX_ANNOTATIONS) break;
	}
	return result;
}

export async function getFigureAnnotations(path: string): Promise<FigureAnnotation[]> {
	const data = await annotationStore().read();
	return normalizeAnnotations(data.files?.[path]?.annotations);
}

export async function saveFigureAnnotations(path: string, input: unknown): Promise<FigureAnnotation[]> {
	const annotations = normalizeAnnotations(input);
	await annotationStore().update((current) => {
		const files = { ...(current.files ?? {}) };
		if (annotations.length) files[path] = { updatedAt: new Date().toISOString(), annotations };
		else delete files[path];
		const entries = Object.entries(files);
		if (entries.length > MAX_FILES) {
			entries.sort((a, b) => b[1].updatedAt.localeCompare(a[1].updatedAt));
			return { version: 1, files: Object.fromEntries(entries.slice(0, MAX_FILES)) };
		}
		return { version: 1, files };
	});
	return annotations;
}
