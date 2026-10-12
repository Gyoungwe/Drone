import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { create } from "zustand";
import { useDialogLayer } from "./dialog-stack";

export interface ContextMenuItem {
	id: string;
	label: string;
	danger?: boolean;
	disabled?: boolean;
	checked?: boolean;
	onSelect: () => void;
}
export type ContextMenuGroups = ContextMenuItem[][];

interface PromptRequest {
	title: string;
	initial: string;
	confirmLabel: string;
	onSubmit: (value: string) => void;
}

interface ContextMenuStore {
	menu: { x: number; y: number; groups: ContextMenuGroups } | null;
	prompt: PromptRequest | null;
	open: (x: number, y: number, groups: ContextMenuGroups) => void;
	close: () => void;
	askText: (request: PromptRequest) => void;
	closePrompt: () => void;
}

export const useContextMenuStore = create<ContextMenuStore>((set) => ({
	menu: null,
	prompt: null,
	open: (x, y, groups) => set({ menu: { x, y, groups: groups.filter((g) => g.length > 0) } }),
	close: () => set({ menu: null }),
	askText: (prompt) => set({ prompt, menu: null }),
	closePrompt: () => set({ prompt: null }),
}));

/** onContextMenu 处理器工厂：阻止系统菜单，在鼠标位置打开。 */
export function contextMenuHandler(build: () => ContextMenuGroups) {
	return (event: {
		preventDefault: () => void;
		stopPropagation: () => void;
		clientX: number;
		clientY: number;
	}) => {
		event.preventDefault();
		event.stopPropagation();
		useContextMenuStore.getState().open(event.clientX, event.clientY, build());
	};
}

export function ContextMenuView({
	x,
	y,
	groups,
	onClose,
}: {
	x: number;
	y: number;
	groups: ContextMenuGroups;
	onClose: () => void;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const [pos, setPos] = useState({ x, y });
	useDialogLayer(onClose);
	// 贴边翻转：菜单不超出窗口
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el || typeof window === "undefined") return;
		const r = el.getBoundingClientRect();
		setPos({
			x: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)),
			y: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)),
		});
	}, [x, y]);
	useEffect(() => {
		ref.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
		const onDown = (e: PointerEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) onClose();
		};
		window.addEventListener("pointerdown", onDown, true);
		window.addEventListener("blur", onClose);
		return () => {
			window.removeEventListener("pointerdown", onDown, true);
			window.removeEventListener("blur", onClose);
		};
	}, [onClose]);
	return (
		<div
			ref={ref}
			className="context-menu"
			role="menu"
			data-testid="context-menu"
			style={{ left: pos.x, top: pos.y }}
			onKeyDown={(e) => {
				if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
				e.preventDefault();
				const buttons = [
					...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? []),
				];
				const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
				buttons[(i + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
			}}
		>
			{groups.map((group, gi) => (
				<div key={group[0]?.id ?? gi} className="context-menu-group">
					{group.map((item) => (
						<button
							key={item.id}
							type="button"
							role="menuitem"
							data-action={item.id}
							disabled={item.disabled}
							className={`context-menu-item${item.danger ? " danger" : ""}`}
							onClick={() => {
								onClose();
								item.onSelect();
							}}
						>
							<span>{item.label}</span>
							{item.checked && <span aria-hidden>✓</span>}
						</button>
					))}
				</div>
			))}
		</div>
	);
}

function PromptDialog({ request, onClose }: { request: PromptRequest; onClose: () => void }) {
	const [value, setValue] = useState(request.initial);
	const inputRef = useRef<HTMLInputElement>(null);
	useDialogLayer(onClose);
	useEffect(() => {
		const el = inputRef.current;
		if (!el) return;
		el.focus();
		const dot = request.initial.lastIndexOf(".");
		el.setSelectionRange(0, dot > 0 ? dot : request.initial.length);
	}, [request.initial]);
	return (
		<div className="context-prompt-backdrop">
			<form
				className="context-prompt"
				role="dialog"
				aria-label={request.title}
				onSubmit={(e) => {
					e.preventDefault();
					onClose();
					request.onSubmit(value);
				}}
			>
				<div className="context-prompt-title">{request.title}</div>
				<input ref={inputRef} value={value} onChange={(e) => setValue(e.target.value)} />
				<div className="context-prompt-actions">
					<button type="button" onClick={onClose}>
						✕
					</button>
					<button type="submit" className="strong">
						{request.confirmLabel}
					</button>
				</div>
			</form>
		</div>
	);
}

/** App 根挂一次。 */
export function ContextMenuHost() {
	const menu = useContextMenuStore((s) => s.menu);
	const prompt = useContextMenuStore((s) => s.prompt);
	const close = useContextMenuStore((s) => s.close);
	const closePrompt = useContextMenuStore((s) => s.closePrompt);
	return (
		<>
			{menu && <ContextMenuView x={menu.x} y={menu.y} groups={menu.groups} onClose={close} />}
			{prompt && <PromptDialog request={prompt} onClose={closePrompt} />}
		</>
	);
}
