import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** P15：灰阶 token 对比度检查（WCAG）。只解析中性 oklch(L% 0 0)，此时相对亮度 Y = L³。 */
const css = readFileSync(join(__dirname, "globals.css"), "utf8");

function block(selector: string): Record<string, string> {
	const start = css.indexOf(`\n${selector} {`);
	const body = css.slice(start, css.indexOf("\n}\n", start));
	const out: Record<string, string> = {};
	for (const m of body.matchAll(/\n\t(--[\w-]+):\s*([^;]+);/g)) if (m[1] && m[2]) out[m[1]] = m[2].trim();
	return out;
}

function luminance(value: string): number {
	const m = value.match(/^oklch\(([\d.]+)% 0 0\)$/);
	if (!m?.[1]) throw new Error(`not a neutral oklch token: ${value}`);
	return (Number(m[1]) / 100) ** 3;
}

function contrast(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
	return (hi + 0.05) / (lo + 0.05);
}

describe("design tokens (P15)", () => {
	const light = block(":root");
	const dark = { ...light, ...block('[data-theme="dark"]') };
	for (const [name, t] of [
		["light", light],
		["dark", dark],
	] as const) {
		it(`${name}: body text meets WCAG AA on canvas and surface`, () => {
			for (const bg of ["--color-canvas", "--color-surface"]) {
				const surface = t[bg] === "#ffffff" ? "oklch(100% 0 0)" : (t[bg] as string);
				expect(contrast(t["--color-ink"] as string, surface)).toBeGreaterThanOrEqual(7);
				expect(contrast(t["--color-ink-2"] as string, surface)).toBeGreaterThanOrEqual(4.5);
				expect(contrast(t["--color-ink-dim"] as string, surface)).toBeGreaterThanOrEqual(3);
			}
		});
		it(`${name}: keeps variable names and adds ClawGo tokens`, () => {
			for (const key of [
				"--color-ink",
				"--color-hover",
				"--color-border",
				"--highlight",
				"--route-accent",
				"--compute-ink",
				"--wiki-paper",
				"--zotero-accent",
				"--scroll-fade-size",
			])
				expect(t[key], key).toBeTruthy();
		});
	}
	it("defines shimmer, scroll-fade and 150ms easing", () => {
		expect(css).toMatch(/@keyframes shimmer \{/);
		expect(css).toMatch(/\.scroll-fade \{/);
		expect(light["--duration-fast"]).toBe("150ms");
		expect(light["--ease-standard"]).toBe("cubic-bezier(0.4, 0, 0.2, 1)");
	});
});
