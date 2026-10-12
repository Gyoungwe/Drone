import { expect, it } from "vitest";
import { isGalleryRoute } from "./gallery-route";

it("only opens the gallery in dev on its hash routes", () => {
	expect(isGalleryRoute("#/__states", true)).toBe(true);
	expect(isGalleryRoute("#/dev/gallery", true)).toBe(true);
	expect(isGalleryRoute("#/__states", false)).toBe(false);
	expect(isGalleryRoute("", true)).toBe(false);
});
