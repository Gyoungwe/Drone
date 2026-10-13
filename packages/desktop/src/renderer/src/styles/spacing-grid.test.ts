import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const HALF_STEP =
	/(?<![\w[-])-?(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|space-x|space-y)-(?:1\.5|2\.5|3\.5)(?![\w.])/;
const OFF_GRID_CSS =
	/\n\s*(?:padding|margin|gap|row-gap|column-gap)(?:-[a-z-]+)?\s*:[^;{}]*\b(?:6|10|14|18|22)px\b/;

function files(dir: string, ext: RegExp): string[] {
	return readdirSync(dir).flatMap((name) => {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) return files(p, ext);
		return ext.test(name) && !name.includes(".test.") ? [p] : [];
	});
}

it("renderer spacing stays on the 4px grid (no 1.5/2.5/3.5 half steps)", () => {
	const bad = files(ROOT, /\.tsx?$/).filter((f) => HALF_STEP.test(readFileSync(f, "utf8")));
	expect(bad).toEqual([]);
});

it("stylesheet padding/margin/gap avoid 6/10/14/18/22px", () => {
	const bad = files(__dirname, /\.css$/).filter((f) => OFF_GRID_CSS.test(readFileSync(f, "utf8")));
	expect(bad).toEqual([]);
});
