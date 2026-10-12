/** .npy 解析（P4）：只支持小端 / 无字节序的数值 dtype，C 或 Fortran 序，1–3 维（3 维取第 0 片）。 */
export interface NpyArray {
	dtype: string;
	shape: number[];
	fortran: boolean;
	/** 展平后的数值（最多 NPY_MAX_VALUES 个） */
	values: Float64Array;
	clipped: boolean;
}
export const NPY_MAX_VALUES = 4_000_000;

const READERS: Record<string, [bytes: number, read: (v: DataView, o: number) => number]> = {
	f8: [8, (v, o) => v.getFloat64(o, true)],
	f4: [4, (v, o) => v.getFloat32(o, true)],
	i8: [8, (v, o) => Number(v.getBigInt64(o, true))],
	u8: [8, (v, o) => Number(v.getBigUint64(o, true))],
	i4: [4, (v, o) => v.getInt32(o, true)],
	u4: [4, (v, o) => v.getUint32(o, true)],
	i2: [2, (v, o) => v.getInt16(o, true)],
	u2: [2, (v, o) => v.getUint16(o, true)],
	i1: [1, (v, o) => v.getInt8(o)],
	u1: [1, (v, o) => v.getUint8(o)],
	b1: [1, (v, o) => v.getUint8(o)],
};

export function parseNpy(bytes: Uint8Array): NpyArray {
	if (bytes.length < 10 || bytes[0] !== 0x93 || String.fromCharCode(...bytes.subarray(1, 6)) !== "NUMPY")
		throw new Error("not an .npy file");
	const major = bytes[6] ?? 1;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const headerLen = major === 1 ? view.getUint16(8, true) : view.getUint32(8, true);
	const start = major === 1 ? 10 : 12;
	const header = new TextDecoder("latin1").decode(bytes.subarray(start, start + headerLen));
	const descr = /'descr':\s*'([^']+)'/.exec(header)?.[1] ?? "";
	const fortran = /'fortran_order':\s*True/.test(header);
	const shapeText = /'shape':\s*\(([^)]*)\)/.exec(header)?.[1] ?? "";
	const shape = shapeText
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean)
		.map(Number);
	if (descr.startsWith(">")) throw new Error(`big-endian dtype ${descr} is not supported`);
	const code = descr.replace(/^[<|=]/, "");
	const reader = READERS[code];
	if (!reader) throw new Error(`unsupported dtype ${descr}`);
	const [size, read] = reader;
	const total = shape.reduce((a, b) => a * b, 1);
	const offset = start + headerLen;
	const available = Math.floor((bytes.length - offset) / size);
	const count = Math.min(total, available, NPY_MAX_VALUES);
	const values = new Float64Array(count);
	for (let i = 0; i < count; i++) values[i] = read(view, offset + i * size);
	return { dtype: code, shape, fortran, values, clipped: count < total };
}

/** 取 2D 视图：1D → 1×N，2D 原样，≥3D 取第 0 片。返回 (r,c) → 值 的访问器。 */
export function npyMatrix(a: NpyArray): { rows: number; cols: number; at: (r: number, c: number) => number } {
	const dims =
		a.shape.length === 0 ? [1, 1] : a.shape.length === 1 ? [1, a.shape[0] ?? 0] : a.shape.slice(-2);
	const rows = dims[0] ?? 0,
		cols = dims[1] ?? 0;
	const at = (r: number, c: number) => {
		const index = a.fortran ? c * rows + r : r * cols + c;
		return a.values[index] ?? Number.NaN;
	};
	return { rows, cols, at };
}

/** 降采样成最多 max×max 的块均值网格，带 min/max，供热图绘制。 */
export function heatmapGrid(
	a: NpyArray,
	max = 128,
): { rows: number; cols: number; cells: Float64Array; min: number; max: number } {
	const m = npyMatrix(a);
	const rows = Math.min(m.rows, max),
		cols = Math.min(m.cols, max);
	const cells = new Float64Array(rows * cols);
	let lo = Number.POSITIVE_INFINITY,
		hi = Number.NEGATIVE_INFINITY;
	for (let r = 0; r < rows; r++)
		for (let c = 0; c < cols; c++) {
			const r0 = Math.floor((r * m.rows) / rows),
				r1 = Math.max(r0 + 1, Math.floor(((r + 1) * m.rows) / rows));
			const c0 = Math.floor((c * m.cols) / cols),
				c1 = Math.max(c0 + 1, Math.floor(((c + 1) * m.cols) / cols));
			let sum = 0,
				n = 0;
			for (let i = r0; i < r1; i++)
				for (let j = c0; j < c1; j++) {
					const v = m.at(i, j);
					if (Number.isFinite(v)) {
						sum += v;
						n++;
					}
				}
			const v = n ? sum / n : Number.NaN;
			cells[r * cols + c] = v;
			if (Number.isFinite(v)) {
				lo = Math.min(lo, v);
				hi = Math.max(hi, v);
			}
		}
	return { rows, cols, cells, min: Number.isFinite(lo) ? lo : 0, max: Number.isFinite(hi) ? hi : 0 };
}
