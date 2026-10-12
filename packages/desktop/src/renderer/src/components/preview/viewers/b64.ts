/** base64 → Uint8Array（预览器解码主进程给的 data）。 */
export function base64Bytes(data: string | undefined): Uint8Array | null {
	if (!data) return null;
	const raw = atob(data);
	const out = new Uint8Array(raw.length);
	for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
	return out;
}
