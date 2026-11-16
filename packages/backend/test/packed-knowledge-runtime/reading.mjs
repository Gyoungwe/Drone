import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { packageChildren, sha256 } from "./helpers.mjs";

async function verifyApplicationOverview(ctx) {
	ctx.stage = "application-overview";
	ctx.overview = await ctx.bridge.invoke(ctx.window, ctx.binding, "overview", null, ctx.application);
	// Index totals describe the entire approved Vault; visible lists/counts below are scoped.
	expect(ctx.overview.index.noteCount).toBe(3);
	expect(ctx.overview.recentNotes.map((note) => note.path)).toEqual([ctx.sharedNote]);
	ctx.processes = await packageChildren(ctx.packageRoot);
	expect(ctx.processes).toHaveLength(2);
	expect(ctx.processes.filter((child) => child.resource)).toHaveLength(1);
	expect(ctx.processes.every((child) => child.ppid === process.pid)).toBe(true);
	ctx.uiSearch = await ctx.bridge.invoke(
		ctx.window,
		ctx.binding,
		"search",
		{ query: "Orchid", revision: ctx.overview.binding.revision },
		ctx.application,
	);
	expect(ctx.uiSearch.hits[0].path).toBe("Library/Methods/orchid.md");

	ctx.readingScopes = [];
}

async function verifyReadingScope(ctx, lease, project, visible) {
	const input = { revision: ctx.overview.binding.revision };
	const invoke = (operation, args) => ctx.bridge.invoke(ctx.window, ctx.binding, operation, args, lease);
	const [graph, links, categories, jobs] = await Promise.all([
		invoke("graph", { ...input, view: "all" }),
		invoke("links", { ...input, path: ctx.sharedNote }),
		invoke("recentByCategory", input),
		invoke("jobs", { ...input, limit: 50 }),
	]);
	for (const response of [graph, links, categories, jobs]) {
		expect(response).toMatchObject({ bindingRevision: input.revision, project });
		expect(JSON.stringify(response)).not.toContain(ctx.otherNote);
	}
	expect(graph.nodes.map((node) => node.path).sort()).toEqual([...visible].sort());
	expect(graph.totalNotes).toBe(visible.length);
	expect(graph.semantic.totalNotes).toBe(visible.length);
	expect(categories.groups.method.map((note) => note.path).sort()).toEqual([...visible].sort());
	expect(categories.counts).toEqual({
		paper: 0,
		software: 0,
		method: visible.length,
		idea: 0,
		other: 0,
	});
	const linked = project === null ? [] : [ctx.currentNote];
	expect(links.outgoing.map((link) => link.path)).toEqual(linked);
	expect(links.incoming.map((link) => link.path)).toEqual(linked);
	expect(jobs.items.every((job) => job.scope === "shared" || job.scope === project)).toBe(true);
	expect(jobs.items.length).toBe(jobs.total);
	expect(jobs.total).toBeGreaterThan(1);
	const firstJob = await invoke("jobs", { ...input, limit: 1 });
	expect(firstJob.items).toHaveLength(1);
	expect(firstJob.nextOffset).toBe(1);
	const remainingJobs = await invoke("jobs", { ...input, offset: firstJob.nextOffset, limit: 50 });
	expect([firstJob.items[0].key, ...remainingJobs.items.map((job) => job.key)].sort()).toEqual(
		jobs.items.map((job) => job.key).sort(),
	);
	expect(remainingJobs.nextOffset).toBeNull();
	const shared = await invoke("readNote", { ...input, path: ctx.sharedNote });
	expect(shared).toMatchObject({ missing: false, category: "method", project, startLine: 1 });
	for (const hidden of project === null ? [ctx.currentNote, ctx.otherNote] : [ctx.otherNote]) {
		await expect(invoke("readNote", { ...input, path: hidden })).rejects.toThrow("scope");
		await expect(invoke("links", { ...input, path: hidden })).rejects.toThrow("scope");
	}
	expect((await invoke("search", { ...input, query: "privatebetasentinel" })).hits).toEqual([]);
	expect((await invoke("search", { ...input, query: "alphasentinel" })).hits.map((hit) => hit.path)).toEqual(
		project === null ? [] : [ctx.currentNote],
	);
	ctx.readingScopes.push({
		project,
		visibleNotes: visible.length,
		jobs: jobs.total,
		hiddenProjectDenied: true,
	});
}

async function verifyApplicationInputs(ctx) {
	ctx.stage = "application-reading-scope";
	await verifyReadingScope(ctx, ctx.application, null, [ctx.sharedNote]);
	ctx.stage = "reading-input-schemas";
	for (const [operation, extra] of [
		["readNote", { path: ctx.sharedNote, startLine: 0 }],
		["links", { path: ctx.sharedNote, project: "beta" }],
		["graph", { limit: 1 }],
		["jobs", { limit: 0 }],
		["recentByCategory", { limit: 25 }],
	])
		await expect(
			ctx.bridge.invoke(
				ctx.window,
				ctx.binding,
				operation,
				{ revision: ctx.overview.binding.revision, ...extra },
				ctx.application,
			),
		).rejects.toThrow("Invalid plugin operation input");
	await expect(
		ctx.bridge.invoke(
			ctx.window,
			ctx.binding,
			"jobs",
			{ revision: ctx.overview.binding.revision + 1 },
			ctx.application,
		),
	).rejects.toThrow("binding changed");
}

async function verifySessionOverview(ctx) {
	ctx.stage = "session-reading-scope";
	await verifyReadingScope(ctx, ctx.selection, "alpha", [ctx.sharedNote, ctx.currentNote]);
	const sessionOverview = await ctx.bridge.invoke(ctx.window, ctx.binding, "overview", null, ctx.selection);
	expect(sessionOverview.project).toBe("alpha");
	expect(sessionOverview.recentNotes.map((note) => note.path).sort()).toEqual(
		[ctx.sharedNote, ctx.currentNote].sort(),
	);
}

async function verifyReadPages(ctx) {
	ctx.stage = "paged-reading-hash-and-lines";
	ctx.firstPage = await ctx.bridge.invoke(
		ctx.window,
		ctx.binding,
		"readNote",
		{ path: ctx.currentNote, revision: ctx.overview.binding.revision },
		ctx.selection,
	);
	expect(ctx.firstPage).toMatchObject({
		missing: false,
		title: "Alpha method",
		category: "method",
		project: "alpha",
		startLine: 1,
		truncated: true,
	});
	expect(ctx.firstPage.hash).toBe(sha256(ctx.currentText));
	const lines = ctx.currentText.split("\n");
	expect(ctx.firstPage.totalLines).toBe(lines.length);
	expect(ctx.firstPage.text).toBe(lines.slice(0, ctx.firstPage.endLine).join("\n"));
	const secondPage = await ctx.bridge.invoke(
		ctx.window,
		ctx.binding,
		"readNote",
		{
			path: ctx.currentNote,
			revision: ctx.overview.binding.revision,
			startLine: ctx.firstPage.endLine + 1,
			expectedHash: ctx.firstPage.hash,
		},
		ctx.selection,
	);
	expect(secondPage.startLine).toBe(ctx.firstPage.endLine + 1);
	expect(secondPage.hash).toBe(ctx.firstPage.hash);
	expect(secondPage.text).toBe(lines.slice(secondPage.startLine - 1, secondPage.endLine).join("\n"));
}

async function verifyChangedRead(ctx) {
	await writeFile(join(ctx.vault, ctx.currentNote), "# Alpha method\nChanged after first page.\n");
	await expect(
		ctx.bridge.invoke(
			ctx.window,
			ctx.binding,
			"readNote",
			{ path: ctx.currentNote, revision: ctx.overview.binding.revision, expectedHash: ctx.firstPage.hash },
			ctx.selection,
		),
	).rejects.toThrow("Note changed");
	expect(
		await ctx.bridge.invoke(
			ctx.window,
			ctx.binding,
			"readNote",
			{ path: "Library/Methods/missing.md", revision: ctx.overview.binding.revision },
			ctx.selection,
		),
	).toMatchObject({ missing: true, project: "alpha" });
}

async function verifySelectionRefresh(ctx) {
	const backToApplication = ctx.bridge.selectSession(ctx.window, null);
	await verifyReadingScope(ctx, backToApplication, null, [ctx.sharedNote]);
	const restoredSelection = ctx.bridge.selectSession(ctx.window, ctx.session.sessionId);
	await expect(
		ctx.bridge.invoke(
			ctx.window,
			ctx.binding,
			"readNote",
			{ path: ctx.currentNote, revision: ctx.overview.binding.revision },
			ctx.selection,
		),
	).rejects.toThrow();
	await writeFile(join(ctx.vault, "Library/Methods/willow.md"), "# Willow method\nWillow assay evidence.\n");
	ctx.stage = "selected-session-ui-refresh";
	const refreshed = await ctx.bridge.invoke(
		ctx.window,
		ctx.binding,
		"search",
		{ query: "Willow", revision: ctx.overview.binding.revision },
		restoredSelection,
	);
	expect(refreshed.hits[0].path).toBe("Library/Methods/willow.md");
	expect(await packageChildren(ctx.packageRoot)).toEqual(ctx.processes);
}

export async function verifyApplicationReading(ctx) {
	await verifyApplicationOverview(ctx);
	await verifyApplicationInputs(ctx);
}

export async function verifySessionReading(ctx) {
	await verifySessionOverview(ctx);
	await verifyReadPages(ctx);
	await verifyChangedRead(ctx);
	await verifySelectionRefresh(ctx);
}
