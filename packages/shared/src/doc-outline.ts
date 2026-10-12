/**
 * LaTeX / Typst 结构预览（P4）：不编译，只抽出标题层级、段落与公式块，
 * 让用户先看清文档结构；完整排版仍需本机 typst / latexmk。
 */
export type DocBlock =
	| { kind: "heading"; level: number; text: string }
	| { kind: "paragraph"; text: string }
	| { kind: "math"; text: string };
export interface DocOutline {
	title?: string;
	blocks: DocBlock[];
}
const LATEX_LEVEL: Record<string, number> = {
	part: 1,
	chapter: 1,
	section: 1,
	subsection: 2,
	subsubsection: 3,
};

function cleanLatex(text: string): string {
	return text
		.replace(/\\(?:textbf|textit|emph|texttt|underline)\{([^}]*)\}/g, "$1")
		.replace(/\\(?:cite|ref|eqref|label)\{[^}]*\}/g, "[…]")
		.replace(/~/g, " ")
		.replace(/\\[a-zA-Z]+\*?(\[[^\]]*\])?/g, "")
		.replace(/[{}]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

export function latexOutline(source: string): DocOutline {
	const body = source.replace(/(^|[^\\])%.*$/gm, "$1");
	const title = /\\title\{([^}]*)\}/.exec(body)?.[1];
	const main = body.includes("\\begin{document}")
		? body.slice(body.indexOf("\\begin{document}") + 16, body.indexOf("\\end{document}") >>> 0 || undefined)
		: body;
	const blocks: DocBlock[] = [];
	const re =
		/\\(part|chapter|section|subsection|subsubsection)\*?\{([^}]*)\}|\\begin\{(equation|align|gather)\*?\}([\s\S]*?)\\end\{\3\*?\}|\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\]/g;
	let last = 0;
	const pushText = (text: string) => {
		for (const para of text.split(/\n\s*\n/)) {
			const cleaned = cleanLatex(para);
			if (cleaned) blocks.push({ kind: "paragraph", text: cleaned });
		}
	};
	for (const m of main.matchAll(re)) {
		pushText(main.slice(last, m.index));
		last = (m.index ?? 0) + m[0].length;
		if (m[1]) blocks.push({ kind: "heading", level: LATEX_LEVEL[m[1]] ?? 1, text: cleanLatex(m[2] ?? "") });
		else blocks.push({ kind: "math", text: (m[4] ?? m[5] ?? m[6] ?? "").trim() });
	}
	pushText(main.slice(last));
	return { title: title ? cleanLatex(title) : undefined, blocks: blocks.slice(0, 500) };
}

export function typstOutline(source: string): DocOutline {
	const blocks: DocBlock[] = [];
	const lines = source.replace(/\/\/.*$/gm, "").split(/\r?\n/);
	let para: string[] = [];
	const flush = () => {
		const text = para.join(" ").replace(/\s+/g, " ").trim();
		if (text) blocks.push({ kind: "paragraph", text: text.replace(/[*_]/g, "") });
		para = [];
	};
	let title: string | undefined;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		const heading = /^(=+)\s+(.*)$/.exec(line);
		if (heading) {
			flush();
			blocks.push({ kind: "heading", level: heading[1]?.length ?? 1, text: heading[2]?.trim() ?? "" });
		} else if (/^\s*\$\s/.test(line) || /^\s*\$$/.test(line)) {
			flush();
			const math = [line];
			while (!/\s\$\s*$/.test(lines[i] ?? "") && i + 1 < lines.length) math.push(lines[++i] ?? "");
			blocks.push({
				kind: "math",
				text: math
					.join("\n")
					.trim()
					.replace(/^\$\s*|\s*\$$/g, ""),
			});
		} else if (/^#/.test(line)) {
			flush();
			title ??= /title:\s*"([^"]+)"/.exec(line)?.[1] ?? /^#title\[(.*)\]/.exec(line)?.[1];
		} else if (!line.trim()) flush();
		else para.push(line);
	}
	flush();
	return { title, blocks: blocks.slice(0, 500) };
}
