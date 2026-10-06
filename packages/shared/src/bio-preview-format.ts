/**
 * 结果查看器的系统发育树（Newick）与多序列比对（Clustal / Stockholm / PHYLIP / 比对 FASTA）解析。
 * 纯函数、有上限：只服务于侧栏预览，不做格式校验或生物学判断。
 */

export const TREE_MAX_NODES = 5000;
export const ALIGNMENT_MAX_RECORDS = 200;

export interface TreeNode {
	name: string;
	length?: number;
	children: TreeNode[];
}

/** 解析 Newick；失败抛出带位置的错误 */
export function parseNewick(text: string): TreeNode {
	const source = text.replace(/\[[^\]]*\]/g, "").trim();
	let i = 0;
	let count = 0;
	const skip = () => {
		while (i < source.length && /\s/.test(source[i] ?? "")) i++;
	};
	const label = (): string => {
		skip();
		if (source[i] === "'") {
			let value = "";
			i++;
			while (i < source.length) {
				if (source[i] === "'" && source[i + 1] === "'") {
					value += "'";
					i += 2;
				} else if (source[i] === "'") {
					i++;
					break;
				} else value += source[i++];
			}
			return value;
		}
		const start = i;
		while (i < source.length && !/[(),:;\s]/.test(source[i] ?? "")) i++;
		return source.slice(start, i).replaceAll("_", " ");
	};
	const node = (): TreeNode => {
		if (++count > TREE_MAX_NODES) throw new Error(`tree has more than ${TREE_MAX_NODES} nodes`);
		skip();
		const children: TreeNode[] = [];
		if (source[i] === "(") {
			i++;
			children.push(node());
			skip();
			while (source[i] === ",") {
				i++;
				children.push(node());
				skip();
			}
			if (source[i] !== ")") throw new Error(`expected ")" at position ${i + 1}`);
			i++;
		}
		const result: TreeNode = { name: label(), children };
		skip();
		if (source[i] === ":") {
			i++;
			skip();
			const start = i;
			while (i < source.length && /[0-9eE.+-]/.test(source[i] ?? "")) i++;
			const value = Number(source.slice(start, i));
			if (Number.isFinite(value)) result.length = value;
		}
		return result;
	};
	if (!source.startsWith("(") && !source.includes(";")) throw new Error("not a Newick tree");
	const root = node();
	skip();
	if (source[i] !== ";" && i < source.length)
		throw new Error(`unexpected "${source[i]}" at position ${i + 1}`);
	return root;
}

export interface TreeLayoutNode {
	id: number;
	parent: number | null;
	name: string;
	leaf: boolean;
	x: number;
	y: number;
	length?: number;
}

export interface TreeLayout {
	nodes: TreeLayoutNode[];
	leaves: number;
	/** 根到最远叶的距离（有枝长时为枝长和，否则为深度） */
	depth: number;
	hasLengths: boolean;
}

/** 矩形系统发育图布局：叶子按出现顺序 y=0..n-1，x 为累计枝长（无枝长时用深度） */
export function layoutTree(root: TreeNode): TreeLayout {
	const nodes: TreeLayoutNode[] = [];
	let hasLengths = false;
	const scan = (node: TreeNode) => {
		if (node.length !== undefined && node.length > 0) hasLengths = true;
		node.children.forEach(scan);
	};
	scan(root);
	let leafIndex = 0;
	let depth = 0;
	const walk = (node: TreeNode, parent: number | null, x: number): number => {
		const id = nodes.length;
		const entry: TreeLayoutNode = {
			id,
			parent,
			name: node.name,
			leaf: node.children.length === 0,
			x,
			y: 0,
			...(node.length === undefined ? {} : { length: node.length }),
		};
		nodes.push(entry);
		if (entry.leaf) entry.y = leafIndex++;
		else {
			const ys = node.children.map((child) =>
				walk(child, id, x + (hasLengths ? Math.max(0, child.length ?? 0) : 1)),
			);
			entry.y = ((ys[0] ?? 0) + (ys[ys.length - 1] ?? 0)) / 2;
		}
		depth = Math.max(depth, x);
		return entry.y;
	};
	walk(root, null, 0);
	return { nodes, leaves: leafIndex, depth, hasLengths };
}

export interface AlignmentRecord {
	name: string;
	sequence: string;
}

export interface AlignmentPreview {
	format: "clustal" | "stockholm" | "phylip" | "fasta";
	records: AlignmentRecord[];
	length: number;
	warnings: string[];
	clipped: boolean;
}

function collect(order: string[], map: Map<string, string>, name: string, chunk: string) {
	if (!map.has(name)) {
		if (order.length >= ALIGNMENT_MAX_RECORDS) return false;
		order.push(name);
		map.set(name, "");
	}
	map.set(name, (map.get(name) ?? "") + chunk);
	return true;
}

/** 解析多序列比对片段；按扩展名和首行判断格式 */
export function alignmentPreview(text: string, ext: string): AlignmentPreview {
	const lines = text.replace(/^﻿/, "").split(/\r?\n/);
	const first = lines.find((line) => line.trim()) ?? "";
	const order: string[] = [];
	const map = new Map<string, string>();
	const warnings: string[] = [];
	let clipped = false;
	let format: AlignmentPreview["format"];
	if (first.startsWith(">")) {
		format = "fasta";
		let current: string | null = null;
		for (const line of lines) {
			if (line.startsWith(">")) {
				current = line.slice(1).trim().slice(0, 200) || `seq${order.length + 1}`;
				if (!collect(order, map, current, "")) {
					clipped = true;
					break;
				}
			} else if (current) map.set(current, (map.get(current) ?? "") + line.replace(/\s/g, ""));
		}
	} else if (/^#\s*STOCKHOLM/i.test(first) || ["sto", "stk", "stockholm"].includes(ext)) {
		format = "stockholm";
		for (const line of lines) {
			if (!line.trim() || line.startsWith("#") || line.startsWith("//")) continue;
			const [name, seq] = line.trim().split(/\s+/);
			if (name && seq && !collect(order, map, name, seq)) clipped = true;
		}
	} else if (/^\s*\d+\s+\d+/.test(first) || ["phy", "phylip"].includes(ext)) {
		format = "phylip";
		const declared = Number(first.trim().split(/\s+/)[0]) || 0;
		// 前 declared 行为「名称 序列」，其后的块（交错格式）按行序轮流续接
		const body = lines.slice(lines.indexOf(first) + 1).filter((line) => line.trim());
		body.forEach((line, index) => {
			if (index < declared) {
				const match = /^(\S+)\s+(.*)$/.exec(line.trim());
				if (!collect(order, map, match?.[1] ?? `seq${index + 1}`, (match?.[2] ?? "").replace(/\s/g, "")))
					clipped = true;
			} else {
				const name = order[(index - declared) % Math.max(1, order.length)];
				if (name) map.set(name, (map.get(name) ?? "") + line.replace(/\s/g, ""));
			}
		});
	} else {
		format = "clustal";
		for (const line of lines) {
			if (!line.trim() || /^(CLUSTAL|MUSCLE|PROBCONS)/i.test(line) || /^\s/.test(line)) continue;
			const [name, seq] = line.trim().split(/\s+/);
			if (name && seq && !collect(order, map, name, seq)) clipped = true;
		}
	}
	const records = order.map((name) => ({ name, sequence: map.get(name) ?? "" }));
	const lengths = new Set(records.map((record) => record.sequence.length));
	if (lengths.size > 1) warnings.push("序列长度不一致：片段可能被截断，或文件不是比对结果。");
	if (!records.length) warnings.push("未识别到比对记录。");
	return {
		format,
		records,
		length: Math.max(0, ...records.map((record) => record.sequence.length)),
		warnings,
		clipped,
	};
}

/** FASTA 片段是否像比对结果（≥2 条、含 gap、等长） */
export function looksAligned(text: string): boolean {
	if (!text.includes("-")) return false;
	const preview = alignmentPreview(text, "fasta");
	return (
		preview.records.length >= 2 &&
		new Set(preview.records.map((record) => record.sequence.length)).size === 1 &&
		preview.records.some((record) => record.sequence.includes("-"))
	);
}

/** 每列保守度：最常见非 gap 残基占全部序列的比例（0–1） */
export function columnConservation(records: AlignmentRecord[], start = 0, end?: number): number[] {
	const length = Math.max(0, ...records.map((record) => record.sequence.length));
	const stop = Math.min(end ?? length, length);
	const values: number[] = [];
	for (let column = start; column < stop; column++) {
		const counts = new Map<string, number>();
		for (const record of records) {
			const residue = (record.sequence[column] ?? "-").toUpperCase();
			if (residue === "-" || residue === ".") continue;
			counts.set(residue, (counts.get(residue) ?? 0) + 1);
		}
		values.push(records.length ? Math.max(0, ...counts.values()) / records.length : 0);
	}
	return values;
}

/** 残基着色类别：核酸按碱基，蛋白按理化性质 */
export function residueClass(residue: string, nucleotide: boolean): string {
	const value = residue.toUpperCase();
	if (value === "-" || value === ".") return "gap";
	if (nucleotide) return /[ACGTU]/.test(value) ? `nt-${value === "U" ? "T" : value}` : "other";
	if ("AVLIMFWC".includes(value)) return "aa-hydrophobic";
	if ("KRH".includes(value)) return "aa-positive";
	if ("DE".includes(value)) return "aa-negative";
	if ("STNQ".includes(value)) return "aa-polar";
	if ("GP".includes(value)) return "aa-special";
	if (value === "Y") return "aa-aromatic";
	return "other";
}

export function isNucleotideAlignment(records: AlignmentRecord[]): boolean {
	let total = 0;
	let nucleotide = 0;
	for (const record of records.slice(0, 20))
		for (const residue of record.sequence.slice(0, 500)) {
			if (residue === "-" || residue === ".") continue;
			total++;
			if (/[ACGTUN]/i.test(residue)) nucleotide++;
		}
	return total > 0 && nucleotide / total > 0.9;
}
