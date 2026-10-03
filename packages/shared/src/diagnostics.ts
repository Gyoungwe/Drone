/** A redacted, metadata-only runtime diagnostics snapshot. */
export interface DiagnosticsStoreState {
	readonly id: string;
	readonly path: string;
	readonly owner: string;
	readonly schema: number | string;
	readonly sensitivity: "public" | "config" | "private" | "secret";
	readonly status: "missing" | "ok" | "unreadable";
	readonly bytes?: number;
	readonly modifiedAt?: number;
}

export interface DiagnosticsSnapshot {
	readonly version: string;
	readonly platform: string;
	readonly node: string;
	readonly generatedAt: string;
	readonly stores: DiagnosticsStoreState[];
	readonly incidentSnapshot?: unknown;
	readonly logTail?: string[];
}

/**
 * The portable JSON fallback used by the About page when a native archive
 * writer is unavailable.  The wrapper gives support tooling a stable marker
 * without changing the existing app:getDiagnostics response shape.
 */
export interface DiagnosticsPackage {
	readonly format: "drone-diagnostics";
	readonly schema: 1;
	readonly snapshot: DiagnosticsSnapshot;
}

/**
 * Marker used by the save-dialog bridge for binary payloads.
 *
 * The renderer API historically accepted text only.  Keeping the marker in
 * the text channel lets us ship a real ZIP archive without changing every
 * host and SDK implementation of `saveFileDialog` at once.  The main-process
 * save adapter decodes it immediately before writing the selected file.
 */
export const DIAGNOSTICS_ARCHIVE_PREFIX = "drone-diagnostics-zip:v1:";

export function serializeDiagnosticsPackage(snapshot: DiagnosticsSnapshot): string {
	const pkg: DiagnosticsPackage = { format: "drone-diagnostics", schema: 1, snapshot };
	return JSON.stringify(pkg, null, 2);
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function encodeBase64(bytes: Uint8Array): string {
	let output = "";
	for (let index = 0; index < bytes.length; index += 3) {
		const first = bytes[index] ?? 0;
		const second = bytes[index + 1];
		const third = bytes[index + 2];
		const value = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
		output += BASE64_ALPHABET[(value >>> 18) & 63];
		output += BASE64_ALPHABET[(value >>> 12) & 63];
		output += second === undefined ? "=" : BASE64_ALPHABET[(value >>> 6) & 63];
		output += third === undefined ? "=" : BASE64_ALPHABET[value & 63];
	}
	return output;
}

function utf8(value: string): Uint8Array {
	return new TextEncoder().encode(value);
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
	const total = chunks.reduce((size, chunk) => size + chunk.length, 0);
	const result = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.length;
	}
	return result;
}

function u16(value: number): Uint8Array {
	return new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
}

function u32(value: number): Uint8Array {
	return new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]);
}

/** CRC-32 used by the ZIP stored-entry format. */
function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of bytes) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

interface ArchiveEntry {
	readonly name: string;
	readonly data: Uint8Array;
}

/**
 * Build a small dependency-free ZIP archive containing only redacted support
 * metadata.  Entries use ZIP's "stored" method (no compression), so the
 * implementation works in Electron, the browser preload, and CLI builds
 * without pulling a ZIP package into the runtime.
 */
function buildStoredZip(entries: readonly ArchiveEntry[]): Uint8Array {
	const localChunks: Uint8Array[] = [];
	const centralChunks: Uint8Array[] = [];
	let offset = 0;
	for (const entry of entries) {
		const name = utf8(entry.name);
		const checksum = crc32(entry.data);
		const local = concatBytes(
			new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
			u16(20),
			u16(0),
			u16(0),
			u16(0),
			u16(0x21),
			u32(checksum),
			u32(entry.data.length),
			u32(entry.data.length),
			u16(name.length),
			u16(0),
			name,
			entry.data,
		);
		localChunks.push(local);
		centralChunks.push(
			concatBytes(
				new Uint8Array([0x50, 0x4b, 0x01, 0x02]),
				u16(20),
				u16(20),
				u16(0),
				u16(0),
				u16(0),
				u16(0x21),
				u32(checksum),
				u32(entry.data.length),
				u32(entry.data.length),
				u16(name.length),
				u16(0),
				u16(0),
				u16(0),
				u16(0),
				u32(0),
				u32(offset),
				name,
			),
		);
		offset += local.length;
	}
	const local = concatBytes(...localChunks);
	const central = concatBytes(...centralChunks);
	const end = concatBytes(
		new Uint8Array([0x50, 0x4b, 0x05, 0x06]),
		u16(0),
		u16(0),
		u16(entries.length),
		u16(entries.length),
		u32(central.length),
		u32(local.length),
		u16(0),
	);
	return concatBytes(local, central, end);
}

/**
 * Serialize the redacted snapshot as a real `.zip` payload for the About
 * page.  The archive contains no raw storage files, credentials, Vault text,
 * or session messages—only the already-sanitized snapshot and a short README.
 */
export function serializeDiagnosticsArchive(snapshot: DiagnosticsSnapshot): string {
	const diagnostics = serializeDiagnosticsPackage(snapshot);
	const readme =
		"Drone diagnostics package\n\n" +
		"This archive contains redacted runtime and storage metadata only.\n" +
		"It does not include credentials, Vault data, or session content.\n";
	const archive = buildStoredZip([
		{ name: "diagnostics.json", data: utf8(diagnostics) },
		{ name: "README.txt", data: utf8(readme) },
	]);
	return `${DIAGNOSTICS_ARCHIVE_PREFIX}${encodeBase64(archive)}`;
}
