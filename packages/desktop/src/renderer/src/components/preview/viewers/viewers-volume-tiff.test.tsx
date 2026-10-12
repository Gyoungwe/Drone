import type { ResourcePreviewResult } from "@drone/shared";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../i18n", () => ({ useT: () => (key: string) => key }));
vi.mock("../../diff/ResourceCode", () => ({ ResourceCode: () => null }));
vi.mock("../../diff/ResourceMarkdown", () => ({ ResourceMarkdown: () => null }));
vi.stubGlobal("React", React);

import { previewRendererFor } from "../preview-registry";
import "./index";
import { TiffViewer } from "./TiffViewer";
import { VolumeViewer } from "./VolumeViewer";

const r = (over: Partial<ResourcePreviewResult>): ResourcePreviewResult => ({
	path: "/x",
	name: "x",
	mimeType: "application/octet-stream",
	size: 1,
	kind: "binary",
	...over,
});
const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");

function tiff(compression = 1): Uint8Array {
	const w = 2;
	const h = 2;
	const buf = new ArrayBuffer(8 + 2 + 8 * 12 + 4 + w * h);
	const v = new DataView(buf);
	const u = new Uint8Array(buf);
	u[0] = u[1] = 0x49;
	v.setUint16(2, 42, true);
	v.setUint32(4, 8, true);
	const dataAt = 8 + 2 + 8 * 12 + 4;
	const tags: [number, number, number][] = [
		[256, 3, w],
		[257, 3, h],
		[258, 3, 8],
		[259, 3, compression],
		[273, 4, dataAt],
		[277, 3, 1],
		[278, 3, h],
		[279, 4, w * h],
	];
	v.setUint16(8, tags.length, true);
	tags.forEach(([tag, type, val], i) => {
		const e = 10 + i * 12;
		v.setUint16(e, tag, true);
		v.setUint16(e + 2, type, true);
		v.setUint32(e + 4, 1, true);
		if (type === 3) v.setUint16(e + 8, val, true);
		else v.setUint32(e + 8, val, true);
	});
	u.set([0, 80, 160, 240], dataAt);
	return u;
}

function nifti(d: [number, number, number]): Uint8Array {
	const n = d[0] * d[1] * d[2];
	const buf = new ArrayBuffer(352 + n);
	const v = new DataView(buf);
	v.setInt32(0, 348, true);
	v.setInt16(40, 3, true);
	d.forEach((x, i) => {
		v.setInt16(42 + i * 2, x, true);
	});
	v.setInt16(70, 2, true);
	v.setFloat32(108, 352, true);
	new Uint8Array(buf).set([0x6e, 0x2b, 0x31, 0], 344);
	for (let i = 0; i < n; i++) v.setUint8(352 + i, i % 256);
	return new Uint8Array(buf);
}

describe("P4 TIFF / 体数据预览器", () => {
	it("注册到 PreviewHost", () => {
		expect(previewRendererFor("tiff")).toBe(TiffViewer);
		expect(previewRendererFor("volume")).toBe(VolumeViewer);
	});
	it("TIFF 渲染 canvas 与元数据", () => {
		const html = renderToStaticMarkup(
			<TiffViewer src={null} result={r({ name: "a.tif", previewKind: "tiff", data: b64(tiff()) })} />,
		);
		expect(html).toContain('data-testid="preview-tiff"');
		expect(html).toContain("<canvas");
		expect(html).toContain('width="2"');
	});
	it("不支持的压缩只给提示，不崩", () => {
		const html = renderToStaticMarkup(
			<TiffViewer src={null} result={r({ name: "a.tif", previewKind: "tiff", data: b64(tiff(5)) })} />,
		);
		expect(html).toContain("resource.viewer.tiffUnsupported");
		expect(html).not.toContain("<canvas");
	});
	it("体数据渲染三切片 + 滑块，超限给提示", () => {
		const html = renderToStaticMarkup(
			<VolumeViewer
				src={null}
				result={r({ name: "b.nii", previewKind: "volume", data: b64(nifti([4, 3, 2])) })}
			/>,
		);
		for (const a of ["x", "y", "z"]) expect(html).toContain(`volume-slice-${a}`);
		expect((html.match(/type="range"/g) ?? []).length).toBe(3);
		expect(
			renderToStaticMarkup(<VolumeViewer src={null} result={r({ name: "b.nii", previewKind: "volume" })} />),
		).toContain("resource.viewer.mediaTooLarge");
		expect(
			renderToStaticMarkup(
				<VolumeViewer
					src={null}
					result={r({ name: "b.nii", previewKind: "volume", data: b64(new Uint8Array(400)) })}
				/>,
			),
		).toContain("resource.viewer.volumeFailed");
	});
});
