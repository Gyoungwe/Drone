import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

export async function verifyResourceReaders({ window, js, wait, cwd, root, checks, networkRequests }) {
	const reports = join(cwd, "reports");
	await mkdir(reports);
	const report = join(reports, "scientific-report.md");
	const markdown = [
		"# 科研报告预览",
		"",
		"> 这是界面测试样例，不是科研结论。",
		"",
		"## 数据与方法",
		"",
		"**排版、表格和代码**现在可以直接阅读。",
		"",
		"| 样本 | 来源 | 状态 |",
		"| --- | --- | --- |",
		"| sample A | FASTQ | 待质控 |",
		"| sample B | FASTA | 待核对 |",
		"",
		"```python",
		"from pathlib import Path",
		'input_file = Path("reads.fastq.gz")',
		"print(input_file.name)",
		"```",
		"",
		"[打开相对路径数据](./data%20table.csv)",
		"",
		"![远程图像按需打开](https://example.invalid/markdown-image.png)",
		"",
		"[不允许执行的链接](javascript:window.__unsafeResource=1)",
		"",
		"<script>window.__unsafeResource=1</script>",
	].join("\n");
	await writeFile(report, markdown);
	await writeFile(join(reports, "data table.csv"), "sample,note\nfrom-report-folder,relative-link-ok\n");
	await writeFile(
		join(cwd, "paged.csv"),
		`sample,value\n${Array.from({ length: 250 }, (_, i) => `sample-${i},${i}`).join("\n")}`,
	);
	await writeFile(
		join(cwd, "genome.fa"),
		`>chromosome_1 example fragment\n${"ACGTN".repeat(40)}\n>protein_1\nMKWVTFISLLFLFSSAYS\n`,
	);
	await writeFile(join(cwd, "reads.fastq"), "@read1\nACG\nTAC\n+read1\n@+I\nIII\n@incomplete\nACGT\n+\nII\n");
	await writeFile(
		join(cwd, "calls.vcf.gz"),
		gzipSync(
			"##fileformat=VCFv4.3\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSample-A\nchr1\t42\t.\tA\tT\t.\tPASS\t.\tGT\t0/1\n",
		),
	);
	await writeFile(join(cwd, "large.fa.gz"), gzipSync(`>large\n${"ACGT".repeat(2 * 1024 * 1024)}`));
	await writeFile(join(cwd, "genes.gff3"), "##gff-version 3\nchr1\ttest\tgene\t1\t12\t.\t+\t.\tID=gene1\n");
	await writeFile(join(cwd, "intervals.bed"), "chr1\t0\t12\n");
	await writeFile(
		join(cwd, "valid.json"),
		JSON.stringify({ sample: "A", count: 2, files: ["reads.fastq.gz"] }),
	);
	await writeFile(join(cwd, "invalid.json"), '{"sample":');
	await writeFile(join(cwd, "too-deep.json"), `${"[".repeat(40)}0${"]".repeat(40)}`);
	await writeFile(join(cwd, "data.bam"), Buffer.from("BAM\x01"));
	await writeFile(
		join(cwd, "chart.svg"),
		'<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150"><rect width="300" height="150" fill="#ecf5ef"/><text x="20" y="80" font-size="20">Read-only chart</text><script>window.__unsafeResource=1</script></svg>',
	);
	await writeFile(
		join(cwd, "isolated.html"),
		'<!doctype html><html><head><meta http-equiv="refresh" content="0;url=https://example.invalid/refresh"><style>h1{color:#176447}body{background-image:url(https://example.invalid/css)}</style></head><body><h1>隔离 HTML 报告</h1><p>只显示内容，不运行报告里的程序。</p><script>window.top.__unsafeResource=1;fetch("https://example.invalid/script")</script><img src="https://example.invalid/image" onerror="window.top.__unsafeResource=1"><iframe src="https://example.invalid/frame"></iframe><a href="https://example.invalid/link">静态链接文字</a><form action="https://example.invalid/form"><button>submit</button></form></body></html>',
	);
	const pdfObjects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
	];
	const pdfContent = "BT /F1 22 Tf 30 130 Td (Read-only PDF report) Tj ET";
	pdfObjects.push(`<< /Length ${pdfContent.length} >>\nstream\n${pdfContent}\nendstream`);
	let pdf = "%PDF-1.4\n";
	const offsets = [0];
	for (const [i, object] of pdfObjects.entries()) {
		offsets.push(Buffer.byteLength(pdf));
		pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
	}
	const xref = Buffer.byteLength(pdf);
	pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
		.slice(1)
		.map((n) => `${String(n).padStart(10, "0")} 00000 n `)
		.join("\n")}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
	await writeFile(join(cwd, "report.pdf"), pdf);
	await writeFile(join(cwd, "broken.svg"), "<svg><");
	await writeFile(join(cwd, "complex.md"), "**node** ".repeat(3000));
	const open = async (path) => {
		await js(`window.deliveryFixture.open(${JSON.stringify(path)},${JSON.stringify(cwd)});true`);
		await wait(
			`document.querySelector('.resource-meta > span')?.textContent===${JSON.stringify(path.split(/[\\/]/).pop())}`,
		);
	};
	const button = async (scope, text) =>
		js(
			`[...document.querySelectorAll(${JSON.stringify(`${scope} button`)})].find(e=>e.textContent.trim()===${JSON.stringify(text)}).click();true`,
		);
	const query = async (value) =>
		js(
			`(()=>{const e=document.querySelector('[aria-label="筛选预览表格"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`,
		);
	await open(report);
	await wait("!!document.querySelector('[data-testid=resource-markdown] h1')");
	assert.equal(
		await js("document.querySelector('[data-testid=resource-markdown] h1').textContent"),
		"科研报告预览",
	);
	assert(
		await js(
			"!!document.querySelector('[data-testid=resource-markdown] strong') && document.querySelectorAll('[data-testid=resource-markdown] table tbody tr').length===2",
		),
	);
	assert.equal(
		await js(
			"document.querySelectorAll('[data-testid=resource-markdown] script,[data-testid=resource-markdown] img').length",
		),
		0,
	);
	await wait("!!document.querySelector('.resource-markdown .resource-source-line code span[style*=color]')");
	checks.push(
		"Markdown headings, emphasis, tables and lazy syntax highlighting render; raw HTML is literal and images never auto-load",
	);
	await button(".resource-reader-toolbar", "源码");
	await wait(
		"!document.querySelector('[data-testid=resource-markdown]') && document.querySelector('[data-testid=resource-code]')?.innerText.includes('# 科研报告预览')",
	);
	await button(".resource-code-tools", "自动换行");
	assert.equal(await js("document.querySelector('.resource-source').classList.contains('wrap')"), false);
	await button(".resource-reader-toolbar", "预览");
	await wait("!!document.querySelector('[data-testid=resource-markdown]')");
	await js(
		"[...document.querySelectorAll('.resource-markdown a')].find(e=>e.textContent.includes('不允许执行')).click();true",
	);
	await wait("document.querySelector('.resource-sidebar')?.innerText.includes('此链接类型不能')");
	assert.equal(await js("window.__unsafeResource ?? null"), null);
	checks.push(
		"Preview/source and wrapping toggles work; unsafe Markdown navigation is rejected without executing code",
	);
	await js(
		"[...document.querySelectorAll('.resource-markdown a')].find(e=>e.textContent.includes('打开相对路径')).click();true",
	);
	await wait(
		"document.querySelector('[data-testid=resource-table]')?.innerText.includes('from-report-folder')",
	);
	checks.push("Relative Markdown links use the opened report's directory, not the session cwd");
	await open(join(cwd, "paged.csv"));
	await wait("document.querySelector('[data-testid=resource-table]')?.innerText.includes('片段内 200 行')");
	assert.equal(await js("document.querySelectorAll('[data-testid=resource-table] tbody tr').length"), 50);
	await button(".resource-data-tools", "下一页");
	await wait("document.querySelector('[data-testid=resource-table] tbody')?.innerText.includes('sample-50')");
	await query("sample-149");
	await wait("document.querySelectorAll('[data-testid=resource-table] tbody tr').length===1");
	assert(
		await js("document.querySelector('[data-testid=resource-table] tbody').innerText.includes('sample-149')"),
	);
	await query("sample-249");
	await wait("document.querySelector('[data-testid=resource-table]')?.innerText.includes('当前片段没有')");
	await query("");
	await wait("document.querySelectorAll('[data-testid=resource-table] tbody tr').length===50");
	checks.push(
		"CSV paging/filtering work within 200 loaded rows; out-of-snippet records are not invented or counted",
	);
	await window.webContents
		.capturePage()
		.then((image) => writeFile(join(root, "resource-table.png"), image.toPNG()));
	await open(join(cwd, "genome.fa"));
	await wait("document.querySelectorAll('.resource-sequence').length===2");
	assert.equal(
		await js("document.querySelectorAll('.resource-sequence:first-of-type .resource-base').length"),
		200,
	);
	await window.webContents
		.capturePage()
		.then((image) => writeFile(join(root, "resource-sequences.png"), image.toPNG()));
	await open(join(cwd, "reads.fastq"));
	await wait("document.querySelector('.resource-quality')?.textContent==='@+IIII'");
	assert(await js("document.querySelector('.resource-sequences').innerText.includes('长度不一致')"));
	checks.push(
		"FASTA sequence grouping and multiline FASTQ raw quality render; incomplete records remain explicitly unvalidated",
	);
	await open(join(cwd, "calls.vcf.gz"));
	await wait("document.querySelector('[data-testid=resource-table]')?.innerText.includes('Sample-A')");
	assert(await js("document.querySelector('.resource-sidebar').innerText.includes('gzip')"));
	assert(await js("document.querySelector('[data-testid=resource-table] tbody').innerText.includes('0/1')"));
	await open(join(cwd, "genes.gff3"));
	await wait("document.querySelector('[data-testid=resource-table]')?.innerText.includes('start (1-based)')");
	await open(join(cwd, "intervals.bed"));
	await wait("document.querySelector('[data-testid=resource-table]')?.innerText.includes('start (0-based)')");
	assert.equal(await js("document.querySelectorAll('[data-testid=resource-table] thead th').length"), 4);
	await open(join(cwd, "large.fa.gz"));
	await wait("document.querySelector('.resource-sidebar')?.innerText.includes('128 KiB')");
	assert.equal(await js("document.querySelectorAll('.resource-base').length"), 600);
	checks.push(
		"VCF gzip, GFF and BED retain sample/coordinate semantics; high-expansion gzip remains a labelled 128 KiB/600-character snippet",
	);
	await open(join(cwd, "valid.json"));
	await wait("document.querySelectorAll('.resource-source-line').length>3");
	await wait("!!document.querySelector('.resource-source-line code span[style*=color]')");
	const light = await js(
		"document.querySelector('.resource-source-line code span[style*=color]').style.color",
	);
	await js("window.deliveryFixture.theme('dark');true");
	await wait(
		`document.querySelector('.resource-source-line code span[style*=color]')?.style.color!==${JSON.stringify(light)} && !!document.querySelector('.resource-source-line code span[style*=color]')`,
	);
	await window.webContents
		.capturePage()
		.then((image) => writeFile(join(root, "resource-code-dark.png"), image.toPNG()));
	await js("window.deliveryFixture.theme('light');true");
	await open(join(cwd, "invalid.json"));
	await wait("document.querySelector('.resource-sidebar')?.innerText.includes('JSON 无法格式化')");
	await open(join(cwd, "too-deep.json"));
	await wait("document.querySelector('.resource-sidebar')?.innerText.includes('JSON 无法格式化')");
	checks.push(
		"JSON formatting, invalid/deep fallback and light/dark token themes work without auto-repairing data",
	);
	await open(join(cwd, "chart.svg"));
	await wait("document.querySelector('.resource-media img')?.naturalWidth===300");
	await js("document.querySelector('[aria-label=放大图片]').click();true");
	assert.equal(await js("document.querySelector('.resource-media img').style.width"), "125%");
	await button(".resource-reader-toolbar", "源码");
	await wait("document.querySelector('[data-testid=resource-code]')?.innerText.includes('<svg')");
	assert.equal(await js("window.__unsafeResource ?? null"), null);
	await open(join(cwd, "broken.svg"));
	await wait("document.querySelector('.resource-sidebar')?.innerText.includes('图像无法解码')");
	await button(".resource-reader-toolbar", "源码");
	await wait("document.querySelector('[data-testid=resource-code]')?.innerText.includes('<svg><')");
	await open(join(cwd, "complex.md"));
	await wait("document.querySelector('.resource-markdown')?.innerText.includes('结构超过预览上限')");
	checks.push(
		"Malformed SVG retains readable source and structurally truncated Markdown displays an explicit omission notice",
	);
	await open(join(cwd, "report.pdf"));
	await wait("!!document.querySelector('iframe[title=\"report.pdf\"]')");
	await new Promise((resolve) => setTimeout(resolve, 700));
	await window.webContents
		.capturePage()
		.then((image) => writeFile(join(root, "resource-pdf.png"), image.toPNG()));
	checks.push("PDF remains routed to the bounded native iframe viewer (visual compatibility probe captured)");
	await open(join(cwd, "data.bam"));
	await wait("document.querySelector('.resource-sidebar')?.innerText.includes('二进制科研格式')");
	checks.push(
		"SVG image zoom/source toggle works without executing embedded script; BAM remains an explicit external-viewer fallback",
	);
	await open(join(cwd, "isolated.html"));
	await wait("!!document.querySelector('.resource-html-frame')");
	assert(
		await js(
			"(()=>{const f=document.querySelector('.resource-html-frame');return f.getAttribute('sandbox')==='' && f.contentDocument===null && f.srcdoc.includes('隔离 HTML 报告') && !f.srcdoc.includes('<script') && !f.srcdoc.includes('http-equiv=\"refresh\"') && !f.srcdoc.includes('href=')})()",
		),
	);
	await new Promise((resolve) => setTimeout(resolve, 250));
	assert.equal(await js("window.__unsafeResource ?? null"), null);
	assert.deepEqual(networkRequests, []);
	await window.webContents
		.capturePage()
		.then((image) => writeFile(join(root, "resource-html.png"), image.toPNG()));
	checks.push(
		"HTML is opaque-origin sandboxed; scripts/refresh/navigation are removed and CSP blocks every automatic HTTP(S) subresource",
	);
	await open(report);
	await wait("!!document.querySelector('.resource-markdown h1')");
	window.setSize(740, 780);
	await new Promise((resolve) => setTimeout(resolve, 400));
	assert(
		await js(
			"document.querySelector('.resource-sidebar').getBoundingClientRect().width<=window.innerWidth*.8 && document.querySelector('#conversation').getBoundingClientRect().width>100",
		),
	);
	window.setSize(1120, 780);
	await new Promise((resolve) => setTimeout(resolve, 400));
	assert(await js("document.querySelector('.resource-sidebar').getBoundingClientRect().width>=550"));
	await window.webContents
		.capturePage()
		.then((image) => writeFile(join(root, "resource-markdown.png"), image.toPNG()));
	checks.push("Only the resource sidebar widens; at narrow window sizes the conversation remains visible");
}
