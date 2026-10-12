/** P13：开发态画廊路由判定（#/__states 或 #/dev/gallery）。 */
export function isGalleryRoute(hash: string, dev: boolean): boolean {
	return dev && (hash === "#/__states" || hash === "#/dev/gallery");
}
