import type { FigureAnnotation } from "@drone/shared";
import { type MouseEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { getPi } from "../../api";
import { useT } from "../../i18n";
import { COMPOSER_FOCUS_EVENT, NEW_SESSION_DRAFT_KEY, useDraftStore } from "../../stores/drafts";
import { useSessionsStore } from "../../stores/sessions";

export interface FigureSource {
	href: string;
	cwd?: string;
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

/** 把标注整理成发给 Agent 的一段话（编号与图上一致；空标注跳过） */
export function annotationsMessage(header: string, annotations: FigureAnnotation[]): string {
	const lines = annotations
		.map((item, index) => ({ item, index }))
		.filter(({ item }) => item.text.trim())
		.map(
			({ item, index }) => `${index + 1}. (x ${percent(item.x)}, y ${percent(item.y)}) ${item.text.trim()}`,
		);
	return [header, ...lines].join("\n");
}

/** 点击位置 → 相对容器的 0–1 坐标 */
export function relativePoint(
	clientX: number,
	clientY: number,
	rect: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
	const clamp = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
	return {
		x: clamp((clientX - rect.left) / (rect.width || 1)),
		y: clamp((clientY - rect.top) / (rect.height || 1)),
	};
}

function newId(): string {
	return (
		globalThis.crypto?.randomUUID?.() ??
		`a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
	);
}

/**
 * 可标注图：在图片或 HTML 图上点击落点、写说明，标注按文件保存（userData），
 * 一键整理成文字插入当前会话输入框（不自动发送），让 Agent 按标注修改图。
 */
export function FigureAnnotator({
	source,
	name,
	path,
	children,
	block = false,
	width,
}: {
	source: FigureSource;
	name: string;
	path: string;
	children: ReactNode;
	/** HTML 图占满宽度；图片按自身尺寸包裹 */
	block?: boolean;
	/** 图片缩放：作用在标注层容器上，图与落点一起缩放 */
	width?: string;
}) {
	const t = useT();
	const activeSessionId = useSessionsStore((s) => s.activeSessionId);
	const [annotations, setAnnotations] = useState<FigureAnnotation[]>([]);
	const [annotating, setAnnotating] = useState(false);
	const [selected, setSelected] = useState<string | null>(null);
	const [error, setError] = useState("");
	/** 新落点的说明框在渲染后获得焦点 */
	const focusId = useRef<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		setAnnotations([]);
		setSelected(null);
		void getPi()
			.getFigureAnnotations(source.href, source.cwd)
			.then((items) => {
				if (!cancelled) setAnnotations(items);
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [source.href, source.cwd]);

	const persist = useCallback(
		(next: FigureAnnotation[]) => {
			setAnnotations(next);
			void getPi()
				.saveFigureAnnotations(source.href, source.cwd ?? null, next)
				.then(() => setError(""))
				.catch((err: unknown) =>
					setError(
						t("resource.annotate.saveFailed", { error: err instanceof Error ? err.message : String(err) }),
					),
				);
		},
		[source.href, source.cwd, t],
	);

	const add = (event: MouseEvent<HTMLDivElement>) => {
		const point = relativePoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect());
		const item: FigureAnnotation = { id: newId(), ...point, text: "", createdAt: new Date().toISOString() };
		focusId.current = item.id;
		persist([...annotations, item]);
		setSelected(item.id);
	};

	const send = () => {
		const text = annotationsMessage(t("resource.annotate.message", { name, path }), annotations);
		useDraftStore.getState().updateDraft(activeSessionId ?? NEW_SESSION_DRAFT_KEY, (entry) => ({
			...entry,
			text: entry.text ? `${entry.text.replace(/\s+$/, "")}\n\n${text}\n` : `${text}\n`,
		}));
		window.dispatchEvent(new Event(COMPOSER_FOCUS_EVENT));
	};

	const written = annotations.filter((item) => item.text.trim()).length;
	return (
		<div className="figure-annotator-wrap">
			<div className="resource-data-tools figure-annotator-tools">
				<button type="button" aria-pressed={annotating} onClick={() => setAnnotating(!annotating)}>
					{annotating ? t("resource.annotate.done") : t("resource.annotate.toggle")}
				</button>
				{annotations.length > 0 && <span>{t("resource.annotate.count", { count: annotations.length })}</span>}
				<button type="button" disabled={!written} onClick={send}>
					{t("resource.annotate.send")}
				</button>
				{annotations.length > 0 && (
					<button type="button" onClick={() => persist([])}>
						{t("resource.annotate.clear")}
					</button>
				)}
			</div>
			{annotating && <p className="resource-preview-footnote">{t("resource.annotate.hint")}</p>}
			{error && (
				<p role="alert" className="resource-notice">
					{error}
				</p>
			)}
			<div
				className={`figure-annotator${block ? " block" : ""}`}
				data-annotating={annotating || undefined}
				style={width ? { width } : undefined}
			>
				{children}
				{/* biome-ignore lint/a11y/noStaticElementInteractions: pointer placement layer; every note is also editable in the list below */}
				{/* biome-ignore lint/a11y/useKeyWithClickEvents: placement needs a pointer position; notes are managed via the keyboard-accessible list */}
				<div className="figure-overlay" onClick={annotating ? add : undefined}>
					{annotations.map((item, index) => (
						<button
							type="button"
							key={item.id}
							className="figure-pin"
							data-selected={selected === item.id || undefined}
							style={{ left: percent(item.x), top: percent(item.y) }}
							title={item.text}
							onClick={(event) => {
								event.stopPropagation();
								setSelected(item.id);
							}}
						>
							{index + 1}
						</button>
					))}
				</div>
			</div>
			{annotations.length > 0 && (
				<ol className="figure-notes">
					{annotations.map((item, index) => (
						<li key={item.id} data-selected={selected === item.id || undefined}>
							<span className="figure-note-index">{index + 1}</span>
							<textarea
								rows={2}
								value={item.text}
								placeholder={t("resource.annotate.placeholder")}
								ref={(element) => {
									if (element && focusId.current === item.id) {
										focusId.current = null;
										element.focus();
									}
								}}
								onFocus={() => setSelected(item.id)}
								onChange={(event) =>
									setAnnotations(
										annotations.map((other) =>
											other.id === item.id ? { ...other, text: event.target.value } : other,
										),
									)
								}
								onBlur={() => persist(annotations)}
							/>
							<button
								type="button"
								onClick={() => persist(annotations.filter((other) => other.id !== item.id))}
							>
								{t("resource.annotate.remove")}
							</button>
						</li>
					))}
				</ol>
			)}
		</div>
	);
}
