// Isolated real-Electron component/IPC smoke. Never opens the user's Vault or model credentials.

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import electron from "electron";
import { build as bundle } from "esbuild";
import { build as viteBuild } from "vite";

const repo = resolve("."),
	root = await realpath(await mkdtemp(join(tmpdir(), "percho-knowledge-ui-smoke-")));
await mkdir(join(root, "electron-profile"));
console.log("Isolated fixture:", root);
await writeFile(
	join(root, "entry.tsx"),
	`import ${JSON.stringify(join(repo, "scripts/knowledge-ui-smoke/renderer.tsx"))};\nimport './style.css';\n`,
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
const _renderer = await readFile(join(repo, "scripts/knowledge-ui-smoke/renderer.tsx"), "utf8");
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
	entryPoints: [join(repo, "scripts/knowledge-ui-smoke/main.mjs")],
	outfile: join(root, "main.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	external: ["electron"],
	logLevel: "warning",
});
const env = { ...process.env, PERCHO_UI_FIXTURE: root, PERCHO_UI_REPO: repo };
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
