/** STL（ASCII / 二进制）与 OBJ 解析（P4）：只取三角面，超过上限均匀抽样。 */
export type Vec3 = [number, number, number];
export interface Mesh {
	triangles: Float32Array; // 9 floats / triangle
	count: number;
	totalTriangles: number;
	bounds: { min: Vec3; max: Vec3 };
}
export const MESH_MAX_TRIANGLES = 60_000;

function finish(tris: number[], total: number): Mesh {
	const count = tris.length / 9;
	const min: Vec3 = [Infinity, Infinity, Infinity],
		max: Vec3 = [-Infinity, -Infinity, -Infinity];
	for (let i = 0; i < tris.length; i += 3)
		for (let k = 0; k < 3; k++) {
			const v = tris[i + k] ?? 0;
			if (v < (min[k] ?? 0)) min[k] = v;
			if (v > (max[k] ?? 0)) max[k] = v;
		}
	return { triangles: Float32Array.from(tris), count, totalTriangles: total, bounds: { min, max } };
}

function isBinaryStl(bytes: Uint8Array): boolean {
	if (bytes.length < 84) return false;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const n = view.getUint32(80, true);
	return 84 + n * 50 === bytes.length;
}

export function parseStl(bytes: Uint8Array): Mesh {
	if (isBinaryStl(bytes)) {
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		const total = view.getUint32(80, true);
		const step = Math.max(1, Math.ceil(total / MESH_MAX_TRIANGLES));
		const tris: number[] = [];
		for (let t = 0; t < total; t += step) {
			const o = 84 + t * 50 + 12;
			for (let k = 0; k < 9; k++) tris.push(view.getFloat32(o + k * 4, true));
		}
		return finish(tris, total);
	}
	const text = new TextDecoder().decode(bytes);
	const vs = [...text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)].map((m) => [
		Number(m[1]),
		Number(m[2]),
		Number(m[3]),
	]);
	const total = Math.floor(vs.length / 3);
	if (!total) throw new Error("no triangles found");
	const step = Math.max(1, Math.ceil(total / MESH_MAX_TRIANGLES));
	const tris: number[] = [];
	for (let t = 0; t < total; t += step)
		for (let k = 0; k < 3; k++) tris.push(...(vs[t * 3 + k] ?? [0, 0, 0]));
	return finish(tris, total);
}

export function parseObj(text: string): Mesh {
	const verts: Vec3[] = [];
	const faces: number[][] = [];
	for (const line of text.split(/\r?\n/)) {
		if (line.startsWith("v ")) {
			const [, x, y, z] = line.trim().split(/\s+/);
			verts.push([Number(x), Number(y), Number(z)]);
		} else if (line.startsWith("f ")) {
			const idx = line
				.trim()
				.split(/\s+/)
				.slice(1)
				.map((tok) => Number.parseInt(tok.split("/")[0] ?? "", 10))
				.map((i) => (i < 0 ? verts.length + i : i - 1));
			for (let k = 1; k + 1 < idx.length; k++) faces.push([idx[0] ?? 0, idx[k] ?? 0, idx[k + 1] ?? 0]);
		}
	}
	if (!faces.length) throw new Error("no faces found");
	const step = Math.max(1, Math.ceil(faces.length / MESH_MAX_TRIANGLES));
	const tris: number[] = [];
	for (let f = 0; f < faces.length; f += step)
		for (const i of faces[f] ?? []) tris.push(...(verts[i] ?? [0, 0, 0]));
	return finish(tris, faces.length);
}

/** 正交投影 + 平面着色（画家算法）。返回按深度排序的 2D 三角形与亮度。 */
export function projectMesh(
	mesh: Mesh,
	yaw: number,
	pitch: number,
	size: number,
): { points: string; shade: number }[] {
	const { min, max } = mesh.bounds;
	const center = [0, 1, 2].map((k) => ((min[k] ?? 0) + (max[k] ?? 0)) / 2);
	const extent = Math.max(...[0, 1, 2].map((k) => (max[k] ?? 0) - (min[k] ?? 0)), 1e-9);
	const scale = (size * 0.8) / extent;
	const cy = Math.cos(yaw),
		sy = Math.sin(yaw),
		cp = Math.cos(pitch),
		sp = Math.sin(pitch);
	const tf = (i: number): Vec3 => {
		const x = (mesh.triangles[i] ?? 0) - (center[0] ?? 0),
			y = (mesh.triangles[i + 1] ?? 0) - (center[1] ?? 0),
			z = (mesh.triangles[i + 2] ?? 0) - (center[2] ?? 0);
		const x1 = cy * x + sy * z,
			z1 = -sy * x + cy * z;
		const y2 = cp * y - sp * z1,
			z2 = sp * y + cp * z1;
		return [x1, y2, z2];
	};
	const out: { points: string; shade: number; depth: number }[] = [];
	for (let t = 0; t < mesh.count; t++) {
		const a = tf(t * 9),
			b = tf(t * 9 + 3),
			c = tf(t * 9 + 6);
		const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
			v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
		const n = [
			(u[1] ?? 0) * (v[2] ?? 0) - (u[2] ?? 0) * (v[1] ?? 0),
			(u[2] ?? 0) * (v[0] ?? 0) - (u[0] ?? 0) * (v[2] ?? 0),
			(u[0] ?? 0) * (v[1] ?? 0) - (u[1] ?? 0) * (v[0] ?? 0),
		];
		const len = Math.hypot(n[0] ?? 0, n[1] ?? 0, n[2] ?? 0) || 1;
		const shade = Math.abs((n[2] ?? 0) / len) * 0.75 + 0.25;
		const pt = (p: Vec3) => `${(size / 2 + p[0] * scale).toFixed(1)},${(size / 2 - p[1] * scale).toFixed(1)}`;
		out.push({ points: `${pt(a)} ${pt(b)} ${pt(c)}`, shade, depth: (a[2] + b[2] + c[2]) / 3 });
	}
	out.sort((p, q) => p.depth - q.depth);
	return out.map(({ points, shade }) => ({ points, shade }));
}
