import { pinKey, type SearchFilter, type SearchItem, searchPalette } from "@drone/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { onDesktopCommand } from "../../hooks/use-desktop-commands";
import { useT } from "../../i18n";
import { isDailyCwd } from "../../lib/daily";
import { usePinsStore } from "../../stores/pins";
import { deriveProjects, useProjectsStore } from "../../stores/projects";
import { useUiStore } from "../../stores/ui";
import { useDialogLayer } from "../ui/dialog-stack";

const FILTERS: SearchFilter[] = ["all", "pinned", "project", "task"];

/** 由 projects store 组装搜索条目（任务 = 历史会话，项目 = deriveProjects）。 */
export function buildSearchItems(
	state: Parameters<typeof deriveProjects>[0],
	pins: readonly string[],
	untitled: string,
): SearchItem[] {
	const tasks: SearchItem[] = state.allSessions.map((s) => ({
		kind: "task",
		id: s.sessionId,
		title: s.name || untitled,
		subtitle: isDailyCwd(s.cwd) ? undefined : s.cwd.split(/[\\/]/).filter(Boolean).pop(),
		pinned: pins.includes(pinKey("task", s.sessionId)),
		lastActive: s.modifiedAt ?? s.createdAt,
	}));
	const projects: SearchItem[] = deriveProjects(state).map((p) => ({
		kind: "project",
		id: p.cwd,
		title: p.name,
		subtitle: p.cwd,
		pinned: pins.includes(pinKey("project", p.cwd)),
		lastActive: p.lastActive,
	}));
	return [...projects, ...tasks];
}

export function SearchPaletteView({
	items,
	initialFilter = "all",
	onPick,
	onClose,
}: {
	items: SearchItem[];
	initialFilter?: SearchFilter;
	onPick: (item: SearchItem) => void;
	onClose: () => void;
}) {
	const t = useT();
	const [query, setQuery] = useState("");
	const [filter, setFilter] = useState<SearchFilter>(initialFilter);
	const [cursor, setCursor] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	useDialogLayer(onClose);
	const results = useMemo(() => searchPalette(items, query, filter), [items, query, filter]);
	useEffect(() => inputRef.current?.focus(), []);
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: backdrop click closes, keyboard handled by Esc layer
		<div className="search-palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
			<div
				className="search-palette"
				role="dialog"
				aria-label={t("search.title")}
				data-testid="search-palette"
			>
				<input
					ref={inputRef}
					className="search-palette-input"
					placeholder={t("search.placeholder")}
					value={query}
					onChange={(e) => {
						setQuery(e.target.value);
						setCursor(0);
					}}
					onKeyDown={(e) => {
						if (e.key === "ArrowDown") {
							e.preventDefault();
							setCursor((c) => Math.min(results.length - 1, c + 1));
						} else if (e.key === "ArrowUp") {
							e.preventDefault();
							setCursor((c) => Math.max(0, c - 1));
						} else if (e.key === "Enter" && results[cursor]) {
							e.preventDefault();
							onPick(results[cursor]);
						} else if (e.key === "Tab") {
							e.preventDefault();
							setFilter((f) => FILTERS[(FILTERS.indexOf(f) + (e.shiftKey ? 3 : 1)) % 4] ?? "all");
						}
					}}
				/>
				<div className="search-palette-filters" role="tablist">
					{FILTERS.map((f) => (
						<button
							key={f}
							type="button"
							role="tab"
							aria-selected={filter === f}
							className="search-palette-filter"
							onClick={() => {
								setFilter(f);
								setCursor(0);
							}}
						>
							{t(`search.filter.${f}`)}
						</button>
					))}
				</div>
				<div className="search-palette-list" role="listbox">
					{results.length === 0 && <div className="search-palette-empty">{t("search.empty")}</div>}
					{results.map((item, index) => (
						<button
							type="button"
							tabIndex={-1}
							key={pinKey(item.kind, item.id)}
							role="option"
							aria-selected={index === cursor}
							className="search-palette-item"
							onMouseEnter={() => setCursor(index)}
							onMouseDown={(e) => {
								e.preventDefault();
								onPick(item);
							}}
						>
							<span className="search-palette-kind">{t(`search.kind.${item.kind}`)}</span>
							<span className="search-palette-title">{item.title}</span>
							{item.pinned && <span className="search-palette-pin">{t("search.pinned")}</span>}
							{item.subtitle && <span className="search-palette-sub">{item.subtitle}</span>}
						</button>
					))}
				</div>
				<div className="search-palette-foot">{t("search.hint")}</div>
			</div>
		</div>
	);
}

/** 挂在 App 根：⌘K / Ctrl+K（desktop-command search）或 ⌘F 打开。 */
export function SearchPalette() {
	const t = useT();
	const [open, setOpen] = useState(false);
	const allSessions = useProjectsStore((s) => s.allSessions);
	const addedProjects = useProjectsStore((s) => s.addedProjects);
	const pins = usePinsStore((s) => s.pins);
	useEffect(() => {
		const show = () => {
			setOpen(true);
			const projects = useProjectsStore.getState();
			if (!projects.loaded && !projects.loading) void projects.load();
		};
		const offSearch = onDesktopCommand("search", show);
		const offFind = onDesktopCommand("find", show);
		return () => {
			offSearch();
			offFind();
		};
	}, []);
	const items = useMemo(
		() => (open ? buildSearchItems({ allSessions, addedProjects }, pins, t("search.untitled")) : []),
		[open, allSessions, addedProjects, pins, t],
	);
	if (!open) return null;
	return (
		<SearchPaletteView
			items={items}
			onClose={() => setOpen(false)}
			onPick={(item) => {
				setOpen(false);
				const projects = useProjectsStore.getState();
				if (item.kind === "project") {
					projects.select(item.id);
					useUiStore.getState().setView("projects");
					return;
				}
				const session = projects.allSessions.find((s) => s.sessionId === item.id);
				if (session) {
					useUiStore.getState().setView("chat");
					void projects.openSession(session);
				}
			}}
		/>
	);
}
