/**
 * 体数据解析（P4）：NIfTI-1（.nii，.nii.gz 由主进程先解压）与 MRC / CCP4（.mrc / .map / .rec）。
 * 只读头 + 体素数组，提供三个正交切片与最大强度投影（MIP），渲染层自己画。
 */
export type VolumeFormat = "nifti" | "mrc";
export interface Volume {
	format: VolumeFormat;
	/** x, y, z */
	dims: [number, number, number];
	dtype: string;
	/** 体素尺寸（mm / Å），未知为 1 */
	spacing: [number, number, number];
	values: Float32Array;
	min: number;
	max: number;
}
export type Axis = "x" | "y" | "z";
export interface Slice {
	width: number;
	height: number;
	values: Float32Array;
}
/** 体素数上限（解码前检查），约 256³ */
export const VOLUME_MAX_VOXELS = 16_777_216;

type Reader = [bytes: number, name: string, read: (v: DataView, o: number, le: boolean) => number];
const NIFTI_TYPES: Record<number, Reader> = {
	2: [1, "uint8", (v, o) => v.getUint8(o)],
	4: [2, "int16", (v, o, le) => v.getInt16(o, le)],
	8: [4, "int32", (v, o, le) => v.getInt32(o, le)],
	16: [4, "float32", (v, o, le) => v.getFloat32(o, le)],
	64: [8, "float64", (v, o, le) => v.getFloat64(o, le)],
	256: [1, "int8", (v, o) => v.getInt8(o)],
	512: [2, "uint16", (v, o, le) => v.getUint16(o, le)],
	768: [4, "uint32", (v, o, le) => v.getUint32(o, le)],
};
const MRC_TYPES: Record<number, Reader> = {
	0: [1, "int8", (v, o) => v.getInt8(o)],
	1: [2, "int16", (v, o, le) => v.getInt16(o, le)],
	2: [4, "float32", (v, o, le) => v.getFloat32(o, le)],
	6: [2, "uint16", (v, o, le) => v.getUint16(o, le)],
};

function fill(
	v: DataView,
	start: number,
	n: number,
	[size, , read]: Reader,
	le: boolean,
	scale = 1,
	inter = 0,
): { values: Float32Array; min: number; max: number } {
	if (start + n * size > v.byteLength) throw new Error("volume data is truncated");
	const values = new Float32Array(n);
	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;
	for (let i = 0; i < n; i++) {
		const x = read(v, start + i * size, le) * scale + inter;
		values[i] = x;
		if (Number.isFinite(x)) {
			if (x < min) min = x;
			if (x > max) max = x;
		}
	}
	if (!Number.isFinite(min)) min = max = 0;
	return { values, min, max };
}

function guard(dims: number[]): [number, number, number] {
	const [x = 1, y = 1, z = 1] = dims.map((d) => Math.max(1, Math.floor(d)));
	if (x * y * z > VOLUME_MAX_VOXELS) throw new Error("volume too large to preview");
	return [x, y, z];
}

export function parseNifti(bytes: Uint8Array): Volume {
	if (bytes.length < 352) throw new Error("not a NIfTI-1 file");
	const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let le = true;
	if (v.getInt32(0, true) !== 348) {
		if (v.getInt32(0, false) !== 348) throw new Error("not a NIfTI-1 file");
		le = false;
	}
	const magic = String.fromCharCode(...bytes.subarray(344, 347));
	if (magic !== "n+1") throw new Error("only single-file NIfTI-1 (.nii) is supported");
	const ndim = v.getInt16(40, le);
	const dims = guard([1, 2, 3].map((i) => (i <= ndim ? v.getInt16(40 + i * 2, le) : 1)));
	const code = v.getInt16(70, le);
	const reader = NIFTI_TYPES[code];
	if (!reader) throw new Error(`unsupported NIfTI datatype ${code}`);
	const spacing = [1, 2, 3].map((i) => Math.abs(v.getFloat32(76 + i * 4, le)) || 1) as [
		number,
		number,
		number,
	];
	const voxOffset = Math.max(352, Math.floor(v.getFloat32(108, le)));
	const slope = v.getFloat32(112, le);
	const inter = v.getFloat32(116, le);
	const scale = slope && Number.isFinite(slope) ? slope : 1;
	const { values, min, max } = fill(
		v,
		voxOffset,
		dims[0] * dims[1] * dims[2],
		reader,
		le,
		scale,
		Number.isFinite(inter) ? inter : 0,
	);
	return { format: "nifti", dims, dtype: reader[1], spacing, values, min, max };
}

export function parseMrc(bytes: Uint8Array): Volume {
	if (bytes.length < 1024) throw new Error("not an MRC file");
	const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	// 机器标记 0x44 0x44 / 0x44 0x41 = 小端；0x11 0x11 = 大端；缺省按小端
	const le = bytes[212] !== 0x11;
	const dims = guard([0, 4, 8].map((o) => v.getInt32(o, le)));
	const mode = v.getInt32(12, le);
	const reader = MRC_TYPES[mode];
	if (!reader) throw new Error(`unsupported MRC mode ${mode}`);
	const ext = Math.max(0, v.getInt32(92, le));
	const cell = [40, 44, 48].map((o) => v.getFloat32(o, le));
	const spacing = cell.map((c, i) => (c > 0 ? c / dims[i as 0 | 1 | 2] : 1)) as [number, number, number];
	const { values, min, max } = fill(v, 1024 + ext, dims[0] * dims[1] * dims[2], reader, le);
	return { format: "mrc", dims, dtype: reader[1], spacing, values, min, max };
}

export function parseVolume(bytes: Uint8Array, name: string): Volume {
	return /\.(mrc|map|rec|ccp4)$/i.test(name) ? parseMrc(bytes) : parseNifti(bytes);
}

/** 正交切片：z → xy 平面；y → xz；x → yz。index 越界会被夹到范围内。 */
export function volumeSlice(vol: Volume, axis: Axis, index: number): Slice {
	const [nx, ny, nz] = vol.dims;
	const at = (x: number, y: number, z: number) => vol.values[x + nx * (y + ny * z)] ?? 0;
	const clamp = (i: number, n: number) => Math.min(n - 1, Math.max(0, Math.floor(i)));
	if (axis === "z") {
		const z = clamp(index, nz);
		const out = new Float32Array(nx * ny);
		for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) out[y * nx + x] = at(x, y, z);
		return { width: nx, height: ny, values: out };
	}
	if (axis === "y") {
		const y = clamp(index, ny);
		const out = new Float32Array(nx * nz);
		for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) out[(nz - 1 - z) * nx + x] = at(x, y, z);
		return { width: nx, height: nz, values: out };
	}
	const x = clamp(index, nx);
	const out = new Float32Array(ny * nz);
	for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) out[(nz - 1 - z) * ny + y] = at(x, y, z);
	return { width: ny, height: nz, values: out };
}

/** 沿 z 的最大强度投影。 */
export function volumeMip(vol: Volume): Slice {
	const [nx, ny, nz] = vol.dims;
	const out = new Float32Array(nx * ny).fill(Number.NEGATIVE_INFINITY);
	for (let z = 0; z < nz; z++)
		for (let i = 0; i < nx * ny; i++) {
			const val = vol.values[z * nx * ny + i] ?? 0;
			if (val > (out[i] ?? 0)) out[i] = val;
		}
	return { width: nx, height: ny, values: out };
}

/** 切片 → 灰度 RGBA（按体数据全局 min–max 拉伸）。 */
export function sliceToRgba(slice: Slice, min: number, max: number): Uint8ClampedArray {
	const span = max - min || 1;
	const rgba = new Uint8ClampedArray(slice.width * slice.height * 4);
	for (let i = 0; i < slice.values.length; i++) {
		const g = (((slice.values[i] ?? 0) - min) / span) * 255;
		rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = g;
		rgba[i * 4 + 3] = 255;
	}
	return rgba;
}
