// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { consentForSource, custodyGrants } from "@drone/backend";
import { expect, it } from "vitest";
import { networkDeclaration } from "./network-declaration";

const require = createRequire(import.meta.url);

/**
 * The manifest of a package the host actually loads.
 *
 * The locked packages in `node_modules/@gyoungwe/*` are the artifacts the host
 * runs, so their manifests are what the host's parser must accept.  Reading
 * them here means a package that declares a shape the host refuses, or a
 * custody kind the host does not keep, fails the build instead of failing at
 * the user's install.
 */
function manifestOf(name: string) {
	let directory = dirname(require.resolve(name));
	while (!existsSync(join(directory, "plugin.manifest.json"))) {
		const parent = dirname(directory);
		if (parent === directory) throw new Error(`${name} ships no plugin.manifest.json`);
		directory = parent;
	}
	return JSON.parse(readFileSync(join(directory, "plugin.manifest.json"), "utf8")) as {
		drone?: { credentials?: unknown; networkPolicy?: unknown };
		permissions?: { network?: unknown };
	};
}

it("the host reads pi-research's zotero-local slot as host custody", () => {
	const declaration = networkDeclaration(manifestOf("@gyoungwe/pi-research"));
	const local = declaration.credentials?.find((slot) => slot.slot === "zotero-local");
	expect(local?.custody).toBe("host-environment");
	expect(custodyGrants(declaration.credentials)).toEqual([
		{ slot: "zotero-local", kind: "zotero-local-key" },
	]);
});

it("the host reads pi-knowledge's webdav slot and endpoint policy", () => {
	const declaration = networkDeclaration(manifestOf("@gyoungwe/pi-knowledge"));
	const webdav = declaration.credentials?.find((slot) => slot.slot === "webdav");
	expect(webdav?.custody).toBe("host-environment");
	expect(custodyGrants(declaration.credentials)).toEqual([{ slot: "webdav", kind: "webdav-password" }]);
	expect(declaration.networkPolicy?.runtimeEndpoint).toEqual({
		allowed: true,
		credentialSlot: "webdav",
	});
});

it("the consent the host would record covers both packages' declarations", () => {
	const research = networkDeclaration(manifestOf("@gyoungwe/pi-research"));
	const knowledge = networkDeclaration(manifestOf("@gyoungwe/pi-knowledge"));
	expect(consentForSource({ pluginId: "p", contentHash: "h", ...research })).toMatchObject({
		custodySlots: ["zotero-local"],
		runtimeEndpoint: false,
	});
	expect(consentForSource({ pluginId: "p", contentHash: "h", ...knowledge })).toMatchObject({
		custodySlots: ["webdav"],
		runtimeEndpoint: true,
	});
});
