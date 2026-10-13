/**
 * U0 对照画廊：node scripts/ui-parity/gallery.mjs [--clawgo dir] [--drone dir] [--before dir]
 * 生成 <drone>/gallery.html：每个画面一行，左 ClawsGO、右 Drone（给 --before 时三列：之前/之后），
 * 下方列出 parity.json 中的差异清单。ClawsGO 截图不入库，默认读 ../clawgo/style/s（或 CLAWGO_DIR）。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k) => {
	const i = args.indexOf(k);
	return i >= 0 ? args[i + 1] : undefined;
};
const drone = resolve(opt("--drone") ?? join(here, "out"));
const before = opt("--before") ? resolve(opt("--before")) : null;
const clawDir = resolve(opt("--clawgo") ?? process.env.CLAWGO_DIR ?? join(here, "../../../clawgo/style/s"));
const deepDir = join(clawDir, "../../deep/shots");
const { screens } = JSON.parse(readFileSync(join(here, "parity.json"), "utf8"));
const esc = (s) =>
	s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const img = (p, label) =>
	p && existsSync(p)
		? `<figure><figcaption>${label}</figcaption><img loading="lazy" src="${esc(relative(drone, p))}"></figure>`
		: `<figure><figcaption>${label}</figcaption><div class="missing">无截图</div></figure>`;
const claw = (name, t) => {
	const f = name.replace("{t}", t === "dark" ? "d" : "l");
	return [join(clawDir, f), join(deepDir, f)].find((p) => existsSync(p)) ?? null;
};
const rows = screens
	.flatMap((s) =>
		["light", "dark"].map(
			(t) => `<section><h2>${esc(s.title)} <small>${s.id} · ${t === "dark" ? "深色" : "浅色"}</small></h2>
<div class="cols">${img(claw(s.clawgo, t), "ClawsGO")}${before ? img(join(before, `${s.id}-${t}.png`), "Drone 之前") : ""}${img(join(drone, `${s.id}-${t}.png`), before ? "Drone 之后" : "Drone")}</div>
<ul>${s.diff.map((d) => `<li>${esc(d)}</li>`).join("") || "<li>无已知差异</li>"}</ul></section>`,
		),
	)
	.join("\n");
writeFileSync(
	join(drone, "gallery.html"),
	`<!doctype html><meta charset="utf-8"><title>Drone × ClawsGO 对照画廊</title>
<style>body{font:13px system-ui,"PingFang SC",sans-serif;margin:24px;color:#222}h2{font-size:15px;margin:28px 0 8px}small{color:#888;font-weight:400}
.cols{display:flex;gap:12px}figure{margin:0;flex:1;min-width:0}figcaption{color:#666;margin-bottom:4px}img{width:100%;border:1px solid #ddd;border-radius:8px}
.missing{height:200px;display:grid;place-items:center;border:1px dashed #ccc;border-radius:8px;color:#999}ul{color:#555;margin:8px 0 0 18px}</style>
<h1>Drone × ClawsGO 对照画廊</h1>${rows}`,
);
console.log(join(drone, "gallery.html"));
