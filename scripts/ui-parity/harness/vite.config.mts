import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
const desk = resolve(__dirname, "../../../packages/desktop");
export default defineConfig({
	root: __dirname,
	resolve: {
		alias: {
			"@drone/shared": resolve(__dirname, "../../../packages/shared/src/index.ts"),
			"@renderer": resolve(desk, "src/renderer/src"),
		},
	},
	plugins: [react(), tailwindcss()],
	server: { port: 5199, fs: { allow: [resolve(__dirname, "../../..")] } },
});
