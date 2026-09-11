import {
	getSkillCategory,
	groupSkillCatalog,
	type LoadedSkill,
	type ResourceScope,
	type SkillCategory,
	skillCatalogSearchText,
	skillDisplayName,
} from "@percho/shared";
import { useMemo, useState } from "react";
import { useI18nStore, useT } from "../../i18n";
import { useSettingsStore } from "../../stores/settings";

function ScopeBadge({ scope }: { scope: ResourceScope }) {
	const t = useT();
	const key =
		scope === "project"
			? "settings.skills.scopeProject"
			: scope === "temporary"
				? "settings.skills.scopeTemporary"
				: "settings.skills.scopeUser";
	return (
		<span
			className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${scope === "project" ? "bg-accent/10 text-accent" : "bg-hover text-ink-2"}`}
		>
			{t(key)}
		</span>
	);
}
function SkillRow({ skill }: { skill: LoadedSkill }) {
	const t = useT(),
		language = useI18nStore((s) => s.language);
	const title = skillDisplayName(skill.name, language);
	return (
		<li className="py-2.5">
			<div className="flex items-center gap-2">
				<span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink" title={title}>
					{title}
				</span>
				{skill.disableModelInvocation && (
					<span className="shrink-0 text-[10px] text-ink-faint">{t("settings.skills.manualOnly")}</span>
				)}
				<ScopeBadge scope={skill.scope} />
			</div>
			<p className="mt-1 break-all font-mono text-[10px] text-ink-dim">/skill:{skill.name}</p>
			<details className="mt-1 text-[11px] text-ink-dim">
				<summary className="cursor-pointer rounded py-1 focus-visible:outline focus-visible:outline-accent">
					{t("skillsCatalog.details")}
				</summary>
				<p className="mt-1 whitespace-pre-wrap leading-relaxed">{skill.description}</p>
				<p className="mt-2 break-all font-mono text-[10px] text-ink-faint">
					{skill.source} · {skill.path}
				</p>
			</details>
		</li>
	);
}

/** One browse surface for every loaded skill; grouping does not alter invocation or installation. */
export function SkillsPanel() {
	const t = useT();
	const skills = useSettingsStore((s) => s.skills),
		diagnostics = useSettingsStore((s) => s.skillDiagnostics);
	const [query, setQuery] = useState("");
	const [category, setCategory] = useState<SkillCategory | "all">("all");
	const [collapsed, setCollapsed] = useState<Set<SkillCategory>>(() => new Set(["setup", "support"]));
	const needle = query.trim().toLocaleLowerCase();
	const allGroups = useMemo(() => groupSkillCatalog(skills ?? []), [skills]);
	const visible = useMemo(
		() =>
			(skills ?? []).filter(
				(skill) =>
					(category === "all" || getSkillCategory(skill.name) === category) &&
					(!needle ||
						[skill.name, skill.description, skill.path, skill.source, skillCatalogSearchText(skill.name)]
							.join(" ")
							.toLocaleLowerCase()
							.includes(needle)),
			),
		[skills, category, needle],
	);
	const groups = useMemo(() => groupSkillCatalog(visible), [visible]);
	const toggle = (key: SkillCategory) =>
		setCollapsed((previous) => {
			const next = new Set(previous);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	if (skills === null)
		return (
			<p className="py-8 text-center text-[13px] text-ink-faint">{t("settings.skills.emptyNoSession")}</p>
		);
	return (
		<div>
			<h3 className="text-[13px] font-medium text-ink">{t("settings.skills.title")}</h3>
			<p className="mt-1 text-[11px] text-ink-faint">
				{t("skillsCatalog.count", { count: skills.length, groups: allGroups.length })}
			</p>
			<p className="mt-1 text-[11px] leading-relaxed text-ink-faint">{t("skillsCatalog.scopeHint")}</p>
			{skills.some((skill) => skill.name === "research-vault") && (
				<section className="mt-3 rounded-lg border border-border bg-hover/40 p-3">
					<h4 className="text-[12px] font-medium text-ink">{t("skillsCatalog.owner")}</h4>
					<p className="mt-1 text-[11px] leading-relaxed text-ink-dim">{t("skillsCatalog.ownerHint")}</p>
					<button
						type="button"
						className="mt-2 rounded px-2 py-1 text-[11px] text-accent hover:bg-hover"
						onClick={() => useSettingsStore.getState().openWith("knowledge")}
					>
						{t("skillsCatalog.manage")}
					</button>
				</section>
			)}
			<div className="mt-3 flex flex-wrap gap-2">
				<input
					aria-label={t("skillsCatalog.search")}
					placeholder={t("skillsCatalog.search")}
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-[12px] text-ink outline-none focus:border-accent"
				/>
				<select
					aria-label={t("skillsCatalog.all")}
					value={category}
					onChange={(event) => setCategory(event.target.value as SkillCategory | "all")}
					className="max-w-full rounded-lg border border-border bg-surface px-2 text-[12px] text-ink"
				>
					<option value="all">{t("skillsCatalog.all")}</option>
					{allGroups.map((group) => (
						<option key={group.category} value={group.category}>
							{t(`skillsCatalog.group.${group.category}`)} ({group.items.length})
						</option>
					))}
				</select>
			</div>
			{groups.length === 0 && (
				<p className="py-8 text-center text-[12px] text-ink-faint">{t("skillsCatalog.noMatch")}</p>
			)}
			{groups.map((group) => {
				const expanded = Boolean(needle) || category !== "all" || !collapsed.has(group.category);
				return (
					<section
						key={group.category}
						className="mt-4"
						aria-label={t(`skillsCatalog.group.${group.category}`)}
					>
						<button
							type="button"
							className="flex w-full items-center gap-2 rounded-lg bg-hover/60 px-3 py-2 text-left text-[12px] font-medium text-ink hover:bg-hover"
							aria-expanded={expanded}
							onClick={() => {
								if (!needle && category === "all") toggle(group.category);
							}}
						>
							<span aria-hidden>{expanded ? "▾" : "▸"}</span>
							{t(`skillsCatalog.group.${group.category}`)}
							<span className="ml-auto text-[11px] text-ink-faint">{group.items.length}</span>
						</button>
						{expanded && (
							<>
								{(group.category === "setup" || group.category === "support") && (
									<p className="mt-2 px-2 text-[11px] leading-relaxed text-ink-faint">
										{t(group.category === "setup" ? "skillsCatalog.setupHint" : "skillsCatalog.supportHint")}
									</p>
								)}
								<ul className="divide-y divide-border px-2">
									{group.items.map((skill) => (
										<SkillRow key={skill.path} skill={skill} />
									))}
								</ul>
							</>
						)}
					</section>
				);
			})}
			{diagnostics.length > 0 && (
				<section className="mt-4">
					<h4 className="text-[11px] font-medium text-ink-2">{t("settings.skills.diagnostics")}</h4>
					<ul className="mt-1 space-y-2">
						{diagnostics.map((diagnostic) => (
							<li
								key={`${diagnostic.type}:${diagnostic.path ?? ""}:${diagnostic.message}`}
								className="break-words text-[11px] leading-relaxed text-ink-dim"
							>
								<span className={diagnostic.type === "error" ? "text-err" : "text-warn"}>
									{diagnostic.type}
								</span>{" "}
								— {diagnostic.message}
							</li>
						))}
					</ul>
				</section>
			)}
		</div>
	);
}
