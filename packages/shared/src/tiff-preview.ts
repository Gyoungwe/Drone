/**
 * TIFF 解析（P4）：基线 TIFF（II / MM 字节序），读取全部 IFD 的页数与第 1 页像素。
 * 支持 无压缩 / PackBits；8 / 16 / 32 位整型与 32 / 64 位浮点；1 通道灰度或 3 / 4 通道 RGB(A)。
 * LZW / Deflate / JPEG 等压缩只返回元数据（unsupported），不做解码，避免引入依赖。
 */
export interface TiffInfo {
	width: number;
	height: number;
	pages: number;
	bitsPerSample: number;
	samplesPerPixel: number;
	sampleFormat: "uint" | "int" | "float";
	compression: number;
	/** 不能解码时的原因；可解码时 undefined */
	unsupported?: string;
}
export interface TiffImage extends TiffInfo {
	/** 降采样后的 RGBA 像素（≤maxSide） */
	rgba: Uint8ClampedArray;
	outWidth: number;
	outHeight: number;
	min: number;
	max: number;
}

const TYPE_SIZE: Record<number, number> = {
	1: 1,
	2: 1,
	3: 2,
	4: 4,
	5: 8,
	6: 1,
	7: 1,
	8: 2,
	9: 4,
	10: 8,
	11: 4,
	12: 8,
};
/** 最大像素数保护（解码前检查）：超过只回元数据 */
export const TIFF_MAX_PIXELS = 40_000_000;

interface Ifd {
	tags: Map<number, number[]>;
	next: number;
}

function readIfd(v: DataView, offset: number, le: boolean): Ifd {
	const count = v.getUint16(offset, le);
	const tags = new Map<number, number[]>();
	for (let i = 0; i < count; i++) {
		const e = offset + 2 + i * 12;
		const tag = v.getUint16(e, le);
		const type = v.getUint16(e + 2, le);
		const n = v.getUint32(e + 4, le);
		const size = TYPE_SIZE[type] ?? 1;
		const inline = size * n <= 4;
		const at = inline ? e + 8 : v.getUint32(e + 8, le);
		const vals: number[] = [];
		const limit = Math.min(n, 65536);
		for (let k = 0; k < limit; k++) {
			const o = at + k * size;
			if (o + size > v.byteLength) break;
			if (type === 3) vals.push(v.getUint16(o, le));
			else if (type === 4) vals.push(v.getUint32(o, le));
			else if (type === 8) vals.push(v.getInt16(o, le));
			else if (type === 9) vals.push(v.getInt32(o, le));
			else vals.push(v.getUint8(o));
		}
		tags.set(tag, vals);
	}
	return { tags, next: v.getUint32(offset + 2 + count * 12, le) };
}

function header(bytes: Uint8Array): { v: DataView; le: boolean; first: number } {
	if (bytes.length < 8) throw new Error("not a TIFF file");
	const le = bytes[0] === 0x49 && bytes[1] === 0x49;
	const be = bytes[0] === 0x4d && bytes[1] === 0x4d;
	if (!le && !be) throw new Error("not a TIFF file");
	const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const magic = v.getUint16(2, le);
	if (magic === 43) throw new Error("BigTIFF is not supported");
	if (magic !== 42) throw new Error("not a TIFF file");
	return { v, le, first: v.getUint32(4, le) };
}

function first(tags: Map<number, number[]>, tag: number, fallback: number): number {
	return tags.get(tag)?.[0] ?? fallback;
}

export function readTiffInfo(bytes: Uint8Array): TiffInfo & { ifd: Ifd; le: boolean } {
	const { v, le, first: off } = header(bytes);
	const ifd = readIfd(v, off, le);
	let pages = 1;
	const seen = new Set([off]);
	for (let next = ifd.next; next && next < v.byteLength && !seen.has(next) && pages < 10_000; pages++) {
		seen.add(next);
		next = readIfd(v, next, le).next;
	}
	const t = ifd.tags;
	const width = first(t, 256, 0);
	const height = first(t, 257, 0);
	const bitsPerSample = first(t, 258, 1);
	const samplesPerPixel = first(t, 277, 1);
	const compression = first(t, 259, 1);
	const fmt = first(t, 339, 1);
	const sampleFormat = fmt === 3 ? "float" : fmt === 2 ? "int" : "uint";
	let unsupported: string | undefined;
	if (compression !== 1 && compression !== 32773) unsupported = `compression ${compression}`;
	else if (![8, 16, 32, 64].includes(bitsPerSample)) unsupported = `${bitsPerSample}-bit samples`;
	else if (first(t, 284, 1) !== 1 && samplesPerPixel > 1) unsupported = "planar configuration";
	else if (width * height > TIFF_MAX_PIXELS) unsupported = "image too large";
	else if (!t.has(273)) unsupported = "tiled layout";
	return {
		width,
		height,
		pages,
		bitsPerSample,
		samplesPerPixel,
		sampleFormat,
		compression,
		unsupported,
		ifd,
		le,
	};
}

function unpackBits(src: Uint8Array, expected: number): Uint8Array {
	const out = new Uint8Array(expected);
	let i = 0;
	let o = 0;
	while (i < src.length && o < expected) {
		const n = ((src[i++] ?? 0) << 24) >> 24;
		if (n >= 0) {
			for (let k = 0; k <= n && o < expected; k++) out[o++] = src[i++] ?? 0;
		} else if (n !== -128) {
			const b = src[i++] ?? 0;
			for (let k = 0; k < 1 - n && o < expected; k++) out[o++] = b;
		}
	}
	return out;
}

/** 解码第 1 页并降采样为 RGBA（灰度按 min–max 拉伸）。 */
export function decodeTiff(bytes: Uint8Array, maxSide = 512): TiffImage {
	const info = readTiffInfo(bytes);
	if (info.unsupported) throw new Error(`unsupported TIFF: ${info.unsupported}`);
	const { width: w, height: h, bitsPerSample: bps, samplesPerPixel: spp, ifd, le } = info;
	const bpp = (bps / 8) * spp;
	const rowBytes = w * bpp;
	const offsets = ifd.tags.get(273) ?? [];
	const counts = ifd.tags.get(279) ?? [];
	const rowsPerStrip = first(ifd.tags, 278, h);
	const raw = new Uint8Array(rowBytes * h);
	let pos = 0;
	for (let s = 0; s < offsets.length && pos < raw.length; s++) {
		const start = offsets[s] ?? 0;
		const len = counts[s] ?? raw.length - pos;
		const chunk = bytes.subarray(start, Math.min(bytes.length, start + len));
		const want = Math.min(raw.length - pos, rowBytes * rowsPerStrip);
		const data = info.compression === 32773 ? unpackBits(chunk, want) : chunk.subarray(0, want);
		raw.set(data, pos);
		pos += want;
	}
	const v = new DataView(raw.buffer);
	const sample = (o: number): number => {
		if (info.sampleFormat === "float") return bps === 64 ? v.getFloat64(o, le) : v.getFloat32(o, le);
		if (bps === 8) return info.sampleFormat === "int" ? v.getInt8(o) : v.getUint8(o);
		if (bps === 16) return info.sampleFormat === "int" ? v.getInt16(o, le) : v.getUint16(o, le);
		return info.sampleFormat === "int" ? v.getInt32(o, le) : v.getUint32(o, le);
	};
	const scale = Math.min(1, maxSide / Math.max(w, h));
	const ow = Math.max(1, Math.round(w * scale));
	const oh = Math.max(1, Math.round(h * scale));
	const step = bps / 8;
	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;
	const picks = new Float64Array(ow * oh * Math.min(spp, 4));
	const ch = Math.min(spp, 4);
	for (let y = 0; y < oh; y++) {
		const sy = Math.min(h - 1, Math.floor(y / scale));
		for (let x = 0; x < ow; x++) {
			const sx = Math.min(w - 1, Math.floor(x / scale));
			for (let c = 0; c < ch; c++) {
				const val = sample(sy * rowBytes + sx * bpp + c * step);
				picks[(y * ow + x) * ch + c] = val;
				if (c < 3 && Number.isFinite(val)) {
					if (val < min) min = val;
					if (val > max) max = val;
				}
			}
		}
	}
	if (!Number.isFinite(min)) min = max = 0;
	const span = max - min || 1;
	const rgba = new Uint8ClampedArray(ow * oh * 4);
	for (let i = 0; i < ow * oh; i++) {
		const g = (c: number) => (((picks[i * ch + c] ?? 0) - min) / span) * 255;
		if (ch >= 3) {
			rgba[i * 4] = g(0);
			rgba[i * 4 + 1] = g(1);
			rgba[i * 4 + 2] = g(2);
			rgba[i * 4 + 3] = ch === 4 && bps === 8 ? (picks[i * ch + 3] ?? 255) : 255;
		} else {
			const val = g(0);
			rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = val;
			rgba[i * 4 + 3] = 255;
		}
	}
	const { ifd: _i, le: _l, ...rest } = info;
	return { ...rest, rgba, outWidth: ow, outHeight: oh, min, max };
}
