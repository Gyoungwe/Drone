// Isolated component smoke; no production instance restart, credentials or writes to a Vault.
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import electron from "electron";
import { build } from "vite";

const repo = resolve("."),
	root = await realpath(await mkdtemp(join(tmpdir(), "drone-permissions-ui-")));
await mkdir(join(root, "profile"));
console.log("Isolated permissions UI fixture:", root);
await writeFile(
	join(root, "entry.tsx"),
	`import ${JSON.stringify(join(repo, "scripts/permissions-smoke/renderer.tsx"))};import './style.css';`,
);
await writeFile(
	join(root, "style.css"),
	`@import ${JSON.stringify(join(repo, "packages/desktop/src/renderer/src/styles/globals.css"))};@source ${JSON.stringify(join(repo, "packages/desktop/src/renderer/src"))};html,body{margin:0;background:var(--color-canvas);color:var(--color-ink);font-family:-apple-system,BlinkMacSystemFont,sans-serif}`,
);
await writeFile(
	join(root, "index.html"),
	`<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script>localStorage.setItem('pi-desktop.lang','zh')</script></head><body><div id="root"></div><script type="module" src="./entry.tsx"></script></body></html>`,
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
await copyFile(join(repo, "scripts/permissions-smoke/main.mjs"), join(root, "main.mjs"));
const env = { ...process.env, DRONE_PERMISSIONS_FIXTURE: root };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [join(root, "main.mjs")], { env, stdio: "inherit" });
const timer = setTimeout(() => child.kill("SIGTERM"), 60000);
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
