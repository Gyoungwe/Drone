// Isolated real-Electron component/IPC smoke. Never opens the user's Vault or model credentials.

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import electron from "electron";
import { build as bundle } from "esbuild";
import { build as viteBuild } from "vite";

const repo = resolve("."),
	root = await realpath(await mkdtemp(join(tmpdir(), "drone-task-delivery-smoke-")));
await mkdir(join(root, "electron-profile"));
// Keep package resolution inside the isolated fixture.  The real host's
// backend pulls ssh2 -> cpu-features, whose optional native binary is not part
// of this UI-only acceptance surface; the bundle below aliases that boundary
// to a deterministic fixture instead of loading a user/native module.
await symlink(join(repo, "node_modules"), join(root, "node_modules"), "junction");
console.log("Isolated fixture:", root);
await writeFile(
	join(root, "entry.tsx"),
	`import ${JSON.stringify(join(repo, "scripts/task-delivery-smoke/renderer.tsx"))};\nimport './style.css';\n`,
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
// Test renderer uses the extra test bridge, not a production API addition.
const _renderer = await readFile(join(repo, "scripts/task-delivery-smoke/renderer.tsx"), "utf8");
// renderer is compiled above, so its fixture query uses knowledgeTest directly in source.
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
	entryPoints: [join(repo, "scripts/task-delivery-smoke/main.mjs")],
	outfile: join(root, "main.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	plugins: [
		{
			name: "isolate-native-backend-dependencies",
			setup(build) {
				build.onResolve({ filter: /^@drone\/backend$/ }, () => ({
					path: "fixture-backend",
					namespace: "fixture-backend",
				}));
				build.onLoad({ filter: /.*/, namespace: "fixture-backend" }, () => ({
					contents: `
						export const setReplyLanguage=()=>{};
						export const createLogger=()=>({debug(){},info(){},warn(){},error(){}});
						export class JsonStore {
							constructor(options){this.defaultValue=options.defaultValue;this.value=this.defaultValue();}
							async read(){return structuredClone(this.value);}
							async update(mutator){const next=structuredClone(this.value);await mutator(next);this.value=next;return structuredClone(next);}
						}
					`,
					loader: "js",
				}));
				build.onResolve({ filter: /^cpu-features$/ }, () => ({
					path: "fixture-cpu-features",
					namespace: "fixture-native",
				}));
				build.onLoad({ filter: /.*/, namespace: "fixture-native" }, () => ({
					contents: "module.exports=()=>({});",
					loader: "js",
				}));
			},
		},
		{
			name: "isolate-updater",
			setup(build) {
				build.onResolve({ filter: /\/updater$/ }, () => ({ path: "isolated-updater", namespace: "fixture" }));
				build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
					contents:
						"const unexpected=()=>{throw new Error('Updater must not run in delivery UI tests')}; export {unexpected as checkForUpdates, unexpected as downloadUpdate, unexpected as installUpdate};",
					loader: "js",
				}));
			},
		},
	],
	banner: {
		js: "import {createRequire as __fixtureCreateRequire} from 'node:module'; const require=__fixtureCreateRequire(import.meta.url);",
	},
	external: ["electron"],
	logLevel: "warning",
});
const env = {
	...process.env,
	DRONE_UI_FIXTURE: root,
	DRONE_UI_REPO: repo,
	NODE_PATH: join(repo, "node_modules"),
};
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
} catch {}
process.exitCode = code === 0 && valid ? 0 : 1;
