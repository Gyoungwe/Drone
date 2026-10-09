// Reproducible isolated GUI validation. Does not touch the user Vault or restart Drone.

import { spawn } from "node:child_process";
import { mkdtemp, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import electron from "electron";
import { build as bundle } from "esbuild";
import { build } from "vite";

const repo = resolve(import.meta.dirname, "..");
const root = await realpath(await mkdtemp(join(tmpdir(), "drone-specialists-ui-")));
await symlink(join(repo, "node_modules"), join(root, "node_modules"), "junction");
console.log("Isolated fixture:", root);
await writeFile(
	join(root, "index.html"),
	`<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/entry.tsx"></script></body></html>`,
);
await writeFile(
	join(root, "fixture.css"),
	`@import ${JSON.stringify(join(repo, "packages/desktop/src/renderer/src/styles/globals.css"))};\n@source ${JSON.stringify(join(repo, "packages/desktop/src/renderer/src"))};\n@source ${JSON.stringify(join(repo, "scripts/knowledge-ui-smoke"))};`,
);
await writeFile(
	join(root, "entry.tsx"),
	`import './fixture.css';\nimport ${JSON.stringify(join(repo, "scripts/knowledge-ui-smoke/renderer.tsx"))};`,
);
await writeFile(
	join(root, "preload-entry.ts"),
	`import ${JSON.stringify(join(repo, "packages/desktop/src/preload/index.ts"))};\nimport {contextBridge,ipcRenderer} from 'electron';contextBridge.exposeInMainWorld('knowledgeTest',{info:()=>ipcRenderer.invoke('knowledge-fixture:info')});`.replaceAll(
		"\\n",
		"\n",
	),
);
const typeboxRoot = join(repo, "node_modules/typebox/build");
const alias = {
	"@drone/shared": join(repo, "packages/shared/src/index.ts"),
	typebox: join(typeboxRoot, "index.mjs"),
	"typebox/value": join(typeboxRoot, "value/index.mjs"),
};
const viteAlias = [
	{ find: /^@drone\/shared$/, replacement: join(repo, "packages/shared/src/index.ts") },
	{ find: /^typebox\/value$/, replacement: join(typeboxRoot, "value/index.mjs") },
	{ find: /^typebox$/, replacement: join(typeboxRoot, "index.mjs") },
	{ find: /^react$/, replacement: join(repo, "node_modules/react") },
	{ find: /^react-dom$/, replacement: join(repo, "node_modules/react-dom") },
	{ find: /^react-dom\/client$/, replacement: join(repo, "node_modules/react-dom/client.js") },
	{ find: /^react\/jsx-runtime$/, replacement: join(repo, "node_modules/react/jsx-runtime.js") },
	{ find: /^react\/jsx-dev-runtime$/, replacement: join(repo, "node_modules/react/jsx-dev-runtime.js") },
];
await bundle({
	entryPoints: [join(repo, "scripts/knowledge-ui-smoke/main.mjs")],
	outfile: join(root, "main.mjs"),
	platform: "node",
	format: "esm",
	bundle: true,
	packages: "external",
	alias,
	plugins: [
		{
			name: "knowledge-source-alias",
			setup(build) {
				build.onResolve({ filter: /^@drone\/knowledge(?:\/.*)?$/ }, (args) => {
					const subpath = args.path.slice("@drone/knowledge".length).replace(/^\//, "") || "index";
					return { path: join(repo, "packages/knowledge/src", `${subpath}.ts`) };
				});
			},
		},
	],
});
await bundle({
	entryPoints: [join(root, "preload-entry.ts")],
	outfile: join(root, "preload.cjs"),
	platform: "node",
	format: "cjs",
	bundle: true,
	packages: "external",
	alias,
});
await build({
	root,
	configFile: false,
	base: "./",
	plugins: [react(), tailwind()],
	resolve: { alias: viteAlias, dedupe: ["react", "react-dom"] },
	build: { target: "esnext", outDir: join(root, "dist"), emptyOutDir: true },
	logLevel: "warn",
});
const _output = await new Promise((res, rej) => {
	const child = spawn(electron, [join(root, "main.mjs")], {
		env: {
			...process.env,
			DRONE_UI_FIXTURE: root,
			DRONE_UI_REPO: repo,
			NODE_PATH: join(repo, "node_modules"),
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
	let text = "";
	child.stdout.on("data", (chunk) => {
		text += chunk;
		process.stdout.write(chunk);
	});
	child.stderr.on("data", (chunk) => {
		text += chunk;
		process.stderr.write(chunk);
	});
	const timer = setTimeout(() => {
		child.kill("SIGTERM");
		rej(new Error("GUI fixture exceeded 120-second budget"));
	}, 120000);
	child.once("error", (error) => {
		clearTimeout(timer);
		rej(error);
	});
	child.once("exit", (code) => {
		clearTimeout(timer);
		code === 0 ? res(text) : rej(new Error(`GUI fixture exited ${code}; inspect ${root}`));
	});
});
console.log(await readFile(join(root, "validation.json"), "utf8"));
await writeFile("/tmp/drone-specialists-ui-result.json", await readFile(join(root, "validation.json")));
