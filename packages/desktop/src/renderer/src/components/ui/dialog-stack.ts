import { useEffect, useId, useSyncExternalStore } from "react";

/**
 * Single stack for every ActionSurface. Only the most recently opened surface is visible and
 * interactive; the rest wait underneath (inert + hidden) so Ask / Trust / Example / Wiki review
 * never collide, and Escape only reaches the top layer.
 */
type Entry = { id: string; onEscape?: () => void };
let stack: Entry[] = [];
const listeners = new Set<() => void>();
const emit = () => {
	for (const fn of listeners) fn();
};

export const dialogStack = {
	push(entry: Entry) {
		stack = [...stack.filter((item) => item.id !== entry.id), entry];
		emit();
	},
	update(id: string, onEscape?: () => void) {
		const item = stack.find((entry) => entry.id === id);
		if (item) item.onEscape = onEscape;
	},
	remove(id: string) {
		const next = stack.filter((item) => item.id !== id);
		if (next.length === stack.length) return;
		stack = next;
		emit();
	},
	top(): Entry | undefined {
		return stack[stack.length - 1];
	},
	depth(id: string): number {
		return stack.findIndex((item) => item.id === id);
	},
	size(): number {
		return stack.length;
	},
	/** Handle Escape for the top layer only. Returns true when a surface consumed it. */
	escape(): boolean {
		const top = stack[stack.length - 1];
		if (!top?.onEscape) return Boolean(top);
		top.onEscape();
		return true;
	},
	subscribe(fn: () => void) {
		listeners.add(fn);
		return () => listeners.delete(fn);
	},
	reset() {
		stack = [];
		emit();
	},
};

let keyListenerInstalled = false;
function installKeyListener() {
	if (keyListenerInstalled || typeof document === "undefined") return;
	keyListenerInstalled = true;
	// Capture phase: runs before component-level listeners so lower layers never see the key.
	document.addEventListener(
		"keydown",
		(event) => {
			if (event.key !== "Escape" || dialogStack.size() === 0) return;
			if (dialogStack.escape()) {
				event.preventDefault();
				event.stopPropagation();
			}
		},
		true,
	);
}

/** Register a surface; returns whether it is the top (visible) layer and its stack depth. */
export function useDialogLayer(onEscape?: () => void): { id: string; isTop: boolean; depth: number } {
	const id = useId();
	// biome-ignore lint/correctness/useExhaustiveDependencies: register once per mount; onEscape is synced below
	useEffect(() => {
		installKeyListener();
		dialogStack.push({ id, onEscape });
		return () => dialogStack.remove(id);
	}, [id]);
	useEffect(() => {
		dialogStack.update(id, onEscape);
	}, [id, onEscape]);
	const depth = useSyncExternalStore(
		dialogStack.subscribe,
		() => dialogStack.depth(id),
		() => 0,
	);
	const size = useSyncExternalStore(dialogStack.subscribe, dialogStack.size, () => 1);
	// Before the mount effect runs (first render / SSR) depth is -1: treat as top so the surface paints immediately.
	return { id, isTop: depth < 0 || depth === size - 1, depth: depth < 0 ? size : depth };
}
