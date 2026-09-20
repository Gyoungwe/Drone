// Isolated component smoke for the subagents panel; no production instance restart, no model, no writes to ~/.pi.
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import electron from "electron";
import { build } from "vite";

const repo = resolve("."),
	root = await realpath(await mkdtemp(join(tmpdir(), "drone-subagents-ui-")));
await mkdir(join(root, "profile"));
console.log("Isolated subagents UI fixture:", root);
await writeFile(
	join(root, "entry.tsx"),
	`import ${JSON.stringify(join(repo, "scripts/subagents-smoke/renderer.tsx"))};import './style.css';`,
);
await writeFile(
	join(root, "style.css"),
	`@import ${JSON.stringify(join(repo, "packages/desktop/src/renderer/src/styles/globals.css"))};@source ${JSON.stringify(join(repo, "packages/desktop/src/renderer/src"))};html,body,#root{margin:0;height:100%;overflow:hidden;background:var(--color-canvas);color:var(--color-ink);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}`,
);
await writeFile(
	join(root, "index.html"),
	`<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script>localStorage.setItem('pi-desktop.lang','zh');localStorage.setItem('drone.panel.tab','subagents');localStorage.setItem('drone.panel.idleOpen','1')</script></head><body><div id="root"></div><script type="module" src="./entry.tsx"></script></body></html>`,
);
await build({
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
await copyFile(join(repo, "scripts/subagents-smoke/main.mjs"), join(root, "main.mjs"));
const env = { ...process.env, DRONE_SUBAGENTS_FIXTURE: root };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [join(root, "main.mjs")], { env, stdio: "inherit" });
const timer = setTimeout(() => child.kill("SIGTERM"), 90000);
const code = await new Promise((resolve, reject) => {
	child.on("exit", (code) => resolve(code ?? 1));
	child.on("error", reject);
});
clearTimeout(timer);
let passed = false;
try {
	passed = JSON.parse(await readFile(join(root, "validation.json"), "utf8")).passed === true;
} catch {}
console.log("Fixture retained at:", root);
process.exitCode = code === 0 && passed ? 0 : 1;
