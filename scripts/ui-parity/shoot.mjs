/**
 * U0 对照基线截图：node scripts/ui-parity/shoot.mjs [--only id,id] [--out dir]
 * 起 harness 的 vite（端口 5210），用无头 Chrome 截指定视口和主题变体。
 * 输出 <out>/<id>-<width>-<variant>.png（默认 scripts/ui-parity/out，已 gitignore）。
 * 场景数据全部来自 harness 内置桩，每次截图一致。需要本机 google-chrome / chromium。
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k) => {
	const i = args.indexOf(k);
	return i >= 0 ? args[i + 1] : undefined;
};
const out = resolve(opt("--out") ?? join(here, "out"));
const only = opt("--only")?.split(",");
const widths = (opt("--widths") ?? "1440").split(",").map((value) => Number(value));
const variants = (opt("--variants") ?? "light,dark").split(",");
const { screens } = JSON.parse(readFileSync(join(here, "parity.json"), "utf8"));
const chrome = process.env.CHROME ?? "google-chrome";
const PORT = 5210;

mkdirSync(out, { recursive: true });
const vite = spawn(
	process.execPath,
	[
		join(here, "../../node_modules/vite/bin/vite.js"),
		"--config",
		join(here, "harness/vite.config.mts"),
		"--port",
		String(PORT),
		"--strictPort",
	],
	{ stdio: "ignore" },
);
const stop = () => vite.kill();
process.on("exit", stop);
for (let i = 0; i < 60; i++) {
	try {
		const r = await fetch(`http://localhost:${PORT}/`);
		if (r.ok) break;
	} catch {}
	await new Promise((r) => setTimeout(r, 500));
}
for (const s of screens) {
	if (only && !only.includes(s.id)) continue;
	for (const width of widths) {
		if (!Number.isInteger(width) || width < 240) throw new Error(`Invalid viewport width: ${width}`);
		for (const variant of variants) {
			const reduced = variant.startsWith("reduced-");
			const theme = reduced ? variant.slice("reduced-".length) : variant;
			if (!["light", "dark"].includes(theme)) throw new Error(`Invalid theme variant: ${variant}`);
			const file = join(out, `${s.id}-${width}-${variant}.png`);
			execFileSync(
				chrome,
				[
					"--headless=new",
					"--no-sandbox",
					"--disable-gpu",
					"--hide-scrollbars",
					"--virtual-time-budget=6000",
					`--window-size=${width},900`,
					...(reduced ? ["--force-prefers-reduced-motion"] : []),
					`--screenshot=${file}`,
					`http://localhost:${PORT}/?scene=${s.drone}&theme=${theme}`,
				],
				{ stdio: "ignore" },
			);
			console.log(file);
		}
	}
}
stop();
