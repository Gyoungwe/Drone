/** P4 测试 / 截图用的最小 TIFF、NIfTI、MRC 构造器（不进 index 导出）。 */
/** 最小 TIFF：单条带、小端，可选 PackBits / 多页。 */
export function tiffBytes(opts: {
	w: number;
	h: number;
	bits?: 8 | 16;
	spp?: 1 | 3;
	pages?: number;
	compression?: number;
	le?: boolean;
	pixel?: (x: number, y: number, c: number) => number;
}): Uint8Array {
	const { w, h, bits = 8, spp = 1, pages = 1, compression = 1, le = true } = opts;
	const pixel = opts.pixel ?? ((x, y) => (x + y) % 256);
	const bps = bits / 8;
	const dataLen = w * h * spp * bps;
	const entries = 9;
	const ifdSize = 2 + entries * 12 + 4;
	const total = 8 + pages * (ifdSize + dataLen);
	const buf = new ArrayBuffer(total);
	const v = new DataView(buf);
	const u = new Uint8Array(buf);
	u[0] = u[1] = le ? 0x49 : 0x4d;
	v.setUint16(2, 42, le);
	v.setUint32(4, 8, le);
	let off = 8;
	for (let p = 0; p < pages; p++) {
		const dataAt = off + ifdSize;
		const tags: [number, number, number][] = [
			[256, 3, w],
			[257, 3, h],
			[258, 3, bits],
			[259, 3, compression],
			[262, 3, spp === 3 ? 2 : 1],
			[273, 4, dataAt],
			[277, 3, spp],
			[278, 3, h],
			[279, 4, dataLen],
		];
		v.setUint16(off, entries, le);
		tags.forEach(([tag, type, val], i) => {
			const e = off + 2 + i * 12;
			v.setUint16(e, tag, le);
			v.setUint16(e + 2, type, le);
			v.setUint32(e + 4, 1, le);
			if (type === 3) v.setUint16(e + 8, val, le);
			else v.setUint32(e + 8, val, le);
		});
		const next = p < pages - 1 ? dataAt + dataLen : 0;
		v.setUint32(off + 2 + entries * 12, next, le);
		for (let y = 0; y < h; y++)
			for (let x = 0; x < w; x++)
				for (let c = 0; c < spp; c++) {
					const o = dataAt + ((y * w + x) * spp + c) * bps;
					if (bits === 8) v.setUint8(o, pixel(x, y, c));
					else v.setUint16(o, pixel(x, y, c), le);
				}
		off = dataAt + dataLen;
	}
	return u;
}

export function niftiBytes(
	dims: [number, number, number],
	value: (x: number, y: number, z: number) => number,
): Uint8Array {
	const n = dims[0] * dims[1] * dims[2];
	const buf = new ArrayBuffer(352 + n * 4);
	const v = new DataView(buf);
	v.setInt32(0, 348, true);
	v.setInt16(40, 3, true);
	dims.forEach((d, i) => {
		v.setInt16(42 + i * 2, d, true);
	});
	v.setInt16(70, 16, true);
	v.setInt16(72, 32, true);
	[1, 2, 2.5].forEach((s, i) => {
		v.setFloat32(80 + i * 4, s, true);
	});
	v.setFloat32(108, 352, true);
	v.setFloat32(112, 1, true);
	new Uint8Array(buf).set([0x6e, 0x2b, 0x31, 0], 344);
	let i = 0;
	for (let z = 0; z < dims[2]; z++)
		for (let y = 0; y < dims[1]; y++)
			for (let x = 0; x < dims[0]; x++) v.setFloat32(352 + 4 * i++, value(x, y, z), true);
	return new Uint8Array(buf);
}

export function mrcBytes(dims: [number, number, number]): Uint8Array {
	const n = dims[0] * dims[1] * dims[2];
	const buf = new ArrayBuffer(1024 + n * 2);
	const v = new DataView(buf);
	dims.forEach((d, i) => {
		v.setInt32(i * 4, d, true);
	});
	v.setInt32(12, 1, true);
	dims.forEach((d, i) => {
		v.setFloat32(40 + i * 4, d * 1.5, true);
	});
	new Uint8Array(buf).set([0x44, 0x44], 212);
	for (let i = 0; i < n; i++) v.setInt16(1024 + i * 2, i - 10, true);
	return new Uint8Array(buf);
}
