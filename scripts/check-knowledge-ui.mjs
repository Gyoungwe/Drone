// Isolated real-Electron smoke; never opens the user's Vault or model credentials.
// Default: host mounts/fallback without any optional UI package.
// DRONE_UI_ACCEPTANCE_PACKAGE_DIR=<installed package root>: full product component
// checks through its public bundle and the actual host builder/API. Neither mode
// substitutes for formal installed-application GUI acceptance.

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import electron from "electron";
import { build as bundle } from "esbuild";
import { build as viteBuild } from "vite";

const packageDir = process.env.DRONE_UI_ACCEPTANCE_PACKAGE_DIR;
const fixtureName = packageDir ? "renderer.tsx" : "fallback-renderer.tsx";
console.log(
	packageDir
		? "Scope: isolated plugin product UI smoke (not formal GUI acceptance)"
		: "Scope: host mount/fallback smoke; no optional UI package required",
);
const repo = resolve("."),
	root = await realpath(await mkdtemp(join(tmpdir(), "drone-knowledge-ui-smoke-")));
await mkdir(join(root, "electron-profile"));
// External Node packages must resolve from the repository while the Electron
// fixture stays isolated from the user's profile.  Keeping these packages
// external also preserves native/conditional exports (notably child_process)
// instead of asking esbuild to synthesize a browser-style dynamic require.
await symlink(join(repo, "node_modules"), join(root, "node_modules"), "junction");
console.log("Isolated fixture:", root);
await writeFile(
	join(root, "entry.tsx"),
	`import ${JSON.stringify(join(repo, `scripts/knowledge-ui-smoke/${fixtureName}`))};\nimport './style.css';\n`,
);
await writeFile(
	join(root, "style.css"),
	`@import ${JSON.stringify(join(repo, "packages/desktop/src/renderer/src/styles/globals.css"))};\n@source ${JSON.stringify(join(repo, "packages/desktop/src/renderer/src"))};\nhtml,body,#root{margin:0;min-height:100%;background:var(--color-canvas);color:var(--color-ink);font-family:-apple-system,BlinkMacSystemFont,sans-serif}\n`,
);
await writeFile(
	join(root, "index.html"),
	`<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script>localStorage.setItem('pi-desktop.lang','zh');</script></head><body><div id="root"></div><script type="module" src="./entry.tsx"></script></body></html>`,
);
await viteBuild({
	configFile: false,
	root,
	base: "./",
	logLevel: "warn",
	plugins: [react(), tailwind()],
	build: { outDir: join(root, "dist"), target: "esnext" },
	resolve: {
		alias: { react: join(repo, "node_modules/react"), "react-dom": join(repo, "node_modules/react-dom") },
	},
});
await writeFile(
	join(root, "preload-entry.ts"),
	`import ${JSON.stringify(join(repo, "packages/desktop/src/preload/index.ts"))};\nimport {contextBridge,ipcRenderer} from 'electron';\n// Extend the test bridge separately; production preload remains unchanged.\ncontextBridge.exposeInMainWorld('knowledgeTest',{info:()=>ipcRenderer.invoke('knowledge-fixture:info')});\n`,
);
if (packageDir) {
	const uiDir = join(await realpath(packageDir), "ui");
	const manifest = JSON.parse(await readFile(join(uiDir, "plugin.json"), "utf8"));
	const entry = relative(uiDir, resolve(uiDir, manifest.main));
	if (isAbsolute(entry) || entry === ".." || entry.startsWith(`..${sep}`))
		throw new Error("UI package main must remain inside its ui directory");
	await bundle({
		entryPoints: [join(repo, "packages/desktop/src/main/ui-plugins/build.ts")],
		outfile: join(root, "plugin-builder.mjs"),
		bundle: true,
		platform: "node",
		format: "esm",
		external: ["esbuild"],
		logLevel: "warning",
	});
	const { buildPlugin } = await import(pathToFileURL(join(root, "plugin-builder.mjs")).href);
	const built = await buildPlugin(uiDir, manifest.main, { outDir: join(root, "dist/candidate-ui") });
	if (!built.ok) throw new Error(built.error);
	await writeFile(join(root, "ui-plugin.json"), JSON.stringify(manifest));
}
await bundle({
	entryPoints: [join(root, "preload-entry.ts")],
	outfile: join(root, "preload.cjs"),
	bundle: true,
	platform: "node",
	format: "cjs",
	external: ["electron"],
	logLevel: "warning",
});
await bundle({
	entryPoints: [
		join(
			repo,
			packageDir ? "scripts/knowledge-ui-smoke/main.mjs" : "scripts/knowledge-ui-smoke/fallback-main.mjs",
		),
	],
	outfile: join(root, "main.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	external: ["electron", "@earendil-works/*", "cross-spawn", "cpu-features"],
	plugins: [
		{
			name: "retain-plugin-host-resolution",
			setup(build) {
				build.onResolve({ filter: /^@gyoungwe\// }, (args) => ({
					path: createRequire(args.importer).resolve(args.path),
					external: true,
				}));
			},
		},
	],
	logLevel: "warning",
});
const env = { ...process.env, DRONE_UI_FIXTURE: root, DRONE_UI_REPO: repo };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [join(root, "main.mjs")], { env, stdio: "inherit" });
const watchdog = setTimeout(() => {
	console.error("Isolated UI smoke exceeded its deadline");
	child.kill("SIGTERM");
}, 120000);
const code = await new Promise((resolve, reject) => {
	child.on("error", reject);
	child.on("exit", (code) => resolve(code ?? 1));
});
clearTimeout(watchdog);
console.log("Fixture retained at:", root);
let valid = false;
try {
	valid = JSON.parse(await readFile(join(root, "validation.json"), "utf8")).passed === true;
} catch (error) {
	console.error("UI smoke validation receipt unavailable:", error);
}
process.exitCode = code === 0 && valid ? 0 : 1;
