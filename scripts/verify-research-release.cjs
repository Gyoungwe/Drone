// Runs before electron-builder packages resources, including direct builder invocations.
const { execFileSync } = require("node:child_process");
const { join } = require("node:path");
module.exports = async function verifyResearchRelease() {
	// The MCP runtime (pi-mcp-adapter) ships in the installer; refuse to package without it.
	execFileSync(process.execPath, [join(__dirname, "stage-pi-packages.mjs"), "--check"], {
		cwd: join(__dirname, ".."),
		stdio: "inherit",
	});
	execFileSync(
		process.env.PYTHON || "python",
		[
			join(__dirname, "sync-research-skills.py"),
			"--sources",
			"nature",
			"scientific",
			"academic",
			"--check",
			"--for-release",
		],
		{ cwd: join(__dirname, ".."), stdio: "inherit" },
	);
};
