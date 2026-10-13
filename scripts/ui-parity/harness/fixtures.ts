import type { ResourcePreviewResult } from "@drone/shared";

const nb = {
	metadata: { kernelspec: { language: "python" } },
	cells: [
		{ cell_type: "markdown", source: "# 差异表达分析\n读取计数矩阵并做 **DESeq2** 风格归一化。" },
		{
			cell_type: "code",
			execution_count: 1,
			source: "import pandas as pd\ncounts = pd.read_csv('counts.tsv', sep='\\t')\ncounts.shape",
			outputs: [{ output_type: "execute_result", data: { "text/plain": "(20531, 12)" } }],
		},
		{
			cell_type: "code",
			execution_count: 2,
			source: "counts['gene'].head()",
			outputs: [{ output_type: "stream", text: "0    TP53\n1    BRCA1\n2    EGFR\n" }],
		},
		{
			cell_type: "code",
			execution_count: 3,
			source: "assert counts.isna().sum().sum() == 0",
			outputs: [{ output_type: "error", ename: "AssertionError", evalue: "存在缺失值" }],
		},
	],
};
export const fixtures: Record<string, ResourcePreviewResult> = {
	notebook: {
		path: "/proj/analysis.ipynb",
		name: "analysis.ipynb",
		mimeType: "text/plain",
		size: 2048,
		kind: "text",
		previewKind: "notebook",
		encoding: "UTF-8",
		text: JSON.stringify(nb),
	},
	mermaid: {
		path: "/proj/flow.mmd",
		name: "flow.mmd",
		mimeType: "text/plain",
		size: 120,
		kind: "text",
		previewKind: "mermaid",
		encoding: "UTF-8",
		text: "graph LR\n  A[原始 FASTQ] --> B[质控 fastp]\n  B --> C[比对 STAR]\n  C --> D[计数 featureCounts]\n  D --> E{DESeq2}\n  E --> F[火山图]",
	},
	csv: {
		path: "/proj/de.csv",
		name: "de.csv",
		mimeType: "text/plain",
		size: 300,
		kind: "text",
		previewKind: "table",
		encoding: "UTF-8",
		text: "gene,log2FC,pvalue,padj\nTP53,2.31,1e-8,3e-6\nBRCA1,-1.12,4e-5,2e-3\nEGFR,0.87,0.01,0.08\nMYC,3.02,2e-12,1e-9\n",
	},
	audio: {
		path: "/proj/note.wav",
		name: "note.wav",
		mimeType: "audio/wav",
		size: 44,
		kind: "binary",
		previewKind: "audio",
		data: "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=",
	},
};

import p4 from "./p4fixtures.json";

fixtures.npy = {
	path: "/proj/expr.npy",
	name: "expr.npy",
	mimeType: "application/x-npy",
	size: 32896,
	kind: "binary",
	previewKind: "array",
	data: p4.npy,
};
fixtures.mesh = {
	path: "/proj/torus.obj",
	name: "torus.obj",
	mimeType: "model/obj",
	size: 30000,
	kind: "binary",
	previewKind: "mesh",
	data: p4.obj,
};
fixtures.latex = {
	path: "/proj/paper.tex",
	name: "paper.tex",
	mimeType: "text/plain",
	size: 600,
	kind: "text",
	previewKind: "latex",
	encoding: "UTF-8",
	text: p4.tex,
};
export function stubPreview(result: ResourcePreviewResult) {
	(window as unknown as { pi: Record<string, unknown> }).pi.previewFile = () => Promise.resolve(result);
}
