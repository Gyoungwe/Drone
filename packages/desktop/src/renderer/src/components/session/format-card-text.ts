type MarkerSpec = {
	pattern: RegExp;
};

const MARKERS: MarkerSpec[] = [
	{ pattern: /[-*•][ \t]+/ },
	{ pattern: /\d+[.)、][ \t]+/ },
	{ pattern: /[一二三四五六七八九十]+[、.][ \t]+/ },
];

function countMatches(value: string, pattern: RegExp): number {
	return value.match(new RegExp(pattern.source, "g"))?.length ?? 0;
}

function markerAfterColon(value: string): MarkerSpec | undefined {
	const match = value.match(/[:：][ \t]*(?:[-*•][ \t]+|\d+[.)、][ \t]+|[一二三四五六七八九十]+[、.][ \t]+)/);
	if (!match) return undefined;
	return MARKERS.find((marker) =>
		new RegExp(`^${marker.pattern.source}`).test(match[0].replace(/^[:：][ \t]*/, "")),
	);
}

function formatLine(line: string): string {
	const normalized = line.replace(/[ \t]+/g, " ").trim();
	if (!normalized) return "";

	const colonMarker = markerAfterColon(normalized);
	const repeatedMarker = MARKERS.find((marker) => countMatches(normalized, marker.pattern) >= 2);
	const marker = colonMarker ?? repeatedMarker;
	if (!marker) return normalized;

	const withColonBreak = colonMarker
		? normalized.replace(new RegExp(`([:：])[ \t]*(?=${marker.pattern.source})`), "$1\n")
		: normalized;
	return withColonBreak.replace(new RegExp(`[ \t]+(?=${marker.pattern.source})`, "g"), "\n");
}

/**
 * Keep model-authored card copy readable when a provider compresses a list into one line.
 * Existing newlines are preserved; a line is split only when its list shape is unambiguous.
 */
export function formatCardText(value: string): string {
	return value.replace(/\r\n?/g, "\n").split("\n").map(formatLine).join("\n").trim();
}
