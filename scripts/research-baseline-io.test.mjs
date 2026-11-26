import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Type } from "typebox";
import * as fx from "./measure-desktop-research-baseline-fixture.mts";
import { checked, nullable, readJson, saveReport, sha256, tokensFor } from "./research-baseline-io.mts";

async function scratch(context) {
	const directory = await mkdtemp(join(tmpdir(), "T564-io-"));
	context.after(() => rm(directory, { recursive: true, force: true }));
	return directory;
}

test("shared report publication preserves bytes, private mode and existing output", async (context) => {
	const directory = await scratch(context),
		out = join(directory, "report.json");
	const report = { value: 0, unknown: null };
	await saveReport(out, report);
	assert.equal(await readFile(out, "utf8"), `${JSON.stringify(report, null, 2)}\n`);
	assert.deepEqual(await readJson(out), report);
	assert.equal((await stat(out)).mode & 0o777, 0o600);
	await assert.rejects(saveReport(out, { changed: true }), { code: "EEXIST" });
	assert.deepEqual(await readJson(out), report);
	assert.deepEqual(await readdir(directory), ["report.json"]);
});

test("serialization failure never publishes or leaves staging files", async (context) => {
	const directory = await scratch(context),
		out = join(directory, "report.json");
	await assert.rejects(saveReport(out, { invalid: 1n }), /BigInt/);
	assert.deepEqual(await readdir(directory), []);
	await writeFile(join(directory, "invalid.json"), "{");
	await assert.rejects(readJson(join(directory, "invalid.json")), SyntaxError);
});

test("hashes and null validation retain the legacy contract", () => {
	assert.equal(sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
	assert.equal(sha256(Buffer.from("abc")), sha256("abc"));
	assert.equal(checked(nullable(Type.Number()), null, "sample"), null);
	assert.throws(() => checked(Type.Number(), null, "sample"), /Invalid sample/);
});

test("token accounting preserves zero, incomplete totals and cache billing semantics", () => {
	const complete = tokensFor([
		{ input: 0, output: 4, cacheRead: 11, cacheWrite: 2 },
		{ input: 10, output: 9, cacheRead: 0, cacheWrite: 1, reasoning: 3 },
	]);
	assert.equal(complete.firstTurnInput, 0);
	assert.equal(complete.billedTotal, 26);
	assert.equal(complete.reasoning, null);
	assert.deepEqual(tokensFor([{ input: 7 }, null]), {
		firstTurnInput: 7,
		cumulativeInput: null,
		cumulativeOutput: null,
		cacheRead: null,
		cacheWrite: null,
		reasoning: null,
		billedTotal: null,
		usageReported: true,
		reportedFields: ["input"],
		unknownUsageSteps: 1,
	});
	assert.equal(tokensFor([null, null]).unknownUsageSteps, 2);
	assert.throws(() => tokensFor([{ input: Number.MAX_SAFE_INTEGER }, { input: 1 }]), /Invalid token total/);
});

test("offline identity transport never delegates and records every denied request", async (context) => {
	const fixture = await fx.prepareDesktopFixture(
			await scratch(context),
			(await readJson(new URL("../fixtures/research-desktop-baseline.json", import.meta.url))).scenarios[0],
		),
		original = globalThis.fetch;
	const guard = fx.installFixtureFetch(fixture.identities);
	try {
		const url = "http://127.0.0.1:23119/api/users/0/items/ABCDEFGH";
		assert.deepEqual(await (await fetch(url)).json(), { data: { DOI: "10.1038/fixturea" } });
		assert.deepEqual(await (await fetch(`${url}/children`)).json(), []);
		for (const [target, options] of [
			[`${url}?x=1`],
			[url, { method: "POST" }],
			["https://example.com"],
			[url.replace("ABCDEFGH", "UNKNOWN1")],
		]) {
			await assert.rejects(fetch(target, options), /forbidden/);
		}
		assert.equal(guard.violations.length, 4);
		assert.throws(() => guard.assertClean(), /forbidden/);
	} finally {
		guard.restore();
	}
	assert.equal(globalThis.fetch, original);
	const identity = fixture.identities[0];
	await fx.assertFixtureIdentity(
		fixture,
		identity,
		{ hash: sha256(await readFile(join(fixture.vault, identity.note_path))), bindingRevision: 1 },
		1,
	);
	await assert.rejects(
		fx.assertFixtureIdentity(fixture, { ...identity, doi: "10.1038/fixtureb" }),
		/identity/,
	);
	await assert.rejects(
		fx.assertFixtureIdentity(fixture, identity, { hash: "stale", bindingRevision: 1 }, 1),
		/changed/,
	);
	await assert.rejects(
		fx.assertFixtureIdentity(fixture, identity, { hash: "stale", bindingRevision: 1 }, 2),
		/revision/,
	);
	await writeFile(
		join(fixture.vault, identity.note_path),
		"# Wrong\nFact\n10.1038/fixturea\nzotero:IJKLMNOP\n",
	);
	await assert.rejects(fx.assertFixtureIdentity(fixture, identity), /identity/);
});

test("all scenarios prepare separate sibling roots without native state or receipts", async (context) => {
	const fixture = await readJson(new URL("../fixtures/research-desktop-baseline.json", import.meta.url));
	const roots = new Set();
	for (const scenario of fixture.scenarios) {
		const prepared = await fx.prepareDesktopFixture(await scratch(context), scenario);
		roots.add(prepared.root);
		assert.deepEqual(await readdir(prepared.app), []);
		assert.deepEqual(await readdir(prepared.resultsRoot), []);
		assert.equal(
			await readFile(join(prepared.vault, "Wiki/Index.md"), "utf8"),
			scenario.files["vault/Wiki/Index.md"],
		);
	}
	assert.equal(roots.size, 4);
	const empty = await scratch(context),
		invalid = structuredClone(fixture.scenarios[0]);
	invalid.files["../escape.md"] = "outside";
	await assert.rejects(fx.prepareDesktopFixture(empty, invalid), /Invalid/);
	assert.deepEqual(await readdir(empty), []);
});
