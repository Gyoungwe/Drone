// Exercise electron-builder's actual extraResources matcher/copier in a temporary directory.
// Does not build/publish an installer or overwrite a running app's output.
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { load } = require("js-yaml");
const { FileMatcher, copyFiles } = require("app-builder-lib/out/fileMatcher.js");
async function main() {
	const desktop = path.resolve(__dirname, "../packages/desktop");
	const config = load(fs.readFileSync(path.join(desktop, "electron-builder.yml"), "utf8"));
	const entries = config.extraResources.filter((e) => e.from.startsWith("resources/research-skills/"));
	const directories = entries.filter((e) => e.to.split("/").length === 2);
	assert.deepEqual(directories.map((e) => e.to).sort(), [
		"research-skills/academic",
		"research-skills/nature",
		"research-skills/scientific",
	]);
	await require("./verify-research-release.cjs")();
	const temporary = fs.mkdtempSync(path.join(tmpdir(), "research-release-copy-"));
	try {
		const matchers = entries.map(
			(e) => new FileMatcher(path.join(desktop, e.from), path.join(temporary, e.to), (s) => s, e.filter),
		);
		await copyFiles(matchers, undefined, false);
		for (const entry of directories) {
			const root = path.join(temporary, entry.to);
			const receipt = JSON.parse(fs.readFileSync(path.join(root, ".drone-pack.json"), "utf8"));
			for (const [relative, expected] of Object.entries(receipt.files)) {
				assert.equal(
					createHash("sha256")
						.update(fs.readFileSync(path.join(root, relative)))
						.digest("hex"),
					expected,
					relative,
				);
			}
			console.log(
				`${entry.to}: copied and verified ${receipt.skills.length} skills / ${Object.keys(receipt.files).length} source files plus receipt`,
			);
		}
	} finally {
		fs.rmSync(temporary, { recursive: true, force: true });
	}
}
main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
