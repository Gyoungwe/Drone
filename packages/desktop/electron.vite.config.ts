import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
	main: {
		plugins: [externalizeDepsPlugin({ exclude: ["@drone/backend", "@drone/shared"] })],
		build: {
			rollupOptions: {
				// ssh2 has an optional cpu-features native module. Keep the package
				// external so electron-builder can rebuild it for Electron's ABI;
				// bundling a Node-built .node file makes packaged startup fail.
				external: ["@earendil-works/pi-coding-agent", "ssh2"],
			},
		},
		resolve: {
			alias: {
				"@drone/backend": resolve(__dirname, "../backend/src/index.ts"),
				"@drone/shared/causality": resolve(__dirname, "../shared/src/causality.ts"),
				"@drone/shared": resolve(__dirname, "../shared/src/index.ts"),
			},
		},
	},
	preload: {
		plugins: [externalizeDepsPlugin({ exclude: ["@drone/shared"] })],
		build: {
			rollupOptions: {
				output: {
					format: "cjs",
					entryFileNames: "index.cjs",
				},
			},
		},
		resolve: {
			alias: {
				"@drone/shared": resolve(__dirname, "../shared/src/index.ts"),
			},
		},
	},
	renderer: {
		resolve: {
			alias: {
				"@drone/shared": resolve(__dirname, "../shared/src/index.ts"),
				"@renderer": resolve(__dirname, "src/renderer/src"),
				// markstream-react 把 stream-monaco 声明为 optional peer 并动态 import 它；
				// 只要该包还在 node_modules 里，vite 就会把 monaco-editor（~19 MB worker +
				// 编辑器内核）打进产物，哪怕运行期永远走不到那条路径。聊天代码块已改由
				// ChatCodeBlock（Shiki）渲染，这里指向空替身，让 monaco 不再进产物。
				"stream-monaco": resolve(__dirname, "src/renderer/src/vendor/stream-monaco-stub.ts"),
			},
		},
		plugins: [react(), tailwindcss()],
	},
});
