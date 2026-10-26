import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { PluginResourceReservations } from "./resource-reservations";

let directory: string;
beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "resource-reservations-"));
});
afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});
function path(key: string) {
	return join(directory, "writers", `${createHash("sha256").update(key).digest("hex")}.lock`);
}
it("unwinds only newly acquired locks when another owner holds a later resource", async () => {
	const existing = new PluginResourceReservations(directory),
		candidate = new PluginResourceReservations(directory);
	existing.reserve("writers", ["index:/canonical/index.sqlite"]);
	const token = await readFile(path("index:/canonical/index.sqlite"), "utf8");
	expect(() =>
		candidate.reserve("writers", ["vault:/canonical/Vault", "index:/canonical/index.sqlite"]),
	).toThrow("already reserved");
	expect(existsSync(path("vault:/canonical/Vault"))).toBe(false);
	expect(await readFile(path("index:/canonical/index.sqlite"), "utf8")).toBe(token);
	candidate.reserve("writers", ["vault:/canonical/Vault"]);
	candidate.dispose();
	existing.dispose();
});
it("preserves a replaced reservation and releases independent owned locks", async () => {
	const owner = new PluginResourceReservations(directory);
	owner.reserve("writers", ["vault:/canonical/Vault", "index:/canonical/index.sqlite"]);
	await writeFile(path("vault:/canonical/Vault"), "different owner\n");
	expect(() => owner.dispose()).toThrow("could not be released");
	expect(await readFile(path("vault:/canonical/Vault"), "utf8")).toBe("different owner\n");
	expect(existsSync(path("index:/canonical/index.sqlite"))).toBe(false);
});
