import { describe, expect, expectTypeOf, it } from "vitest";
import * as backend from "../index";
import { type FrozenP5Batch, freezeP5Batch } from "./p5-batch-review";
import { type FrozenP5Bundle, freezeP5Bundle } from "./p5-bundle-review";
import { createP5FactStore, P5_FACT_STORAGE, P5FactStoreError, p5FactCapabilityHandlers } from "./p5-facts";
import { p5ReceiptCapabilityHandlers } from "./p5-receipt-capabilities";
import {
	createP5ReceiptStore,
	P5_RECEIPT_STORAGE,
	type P5ReceiptStore,
	P5ReceiptStoreError,
} from "./p5-receipt-store";

const publicP5Values = {
	createP5ReceiptStore,
	P5ReceiptStoreError,
	P5_RECEIPT_STORAGE,
	p5ReceiptCapabilityHandlers,
	createP5FactStore,
	P5FactStoreError,
	P5_FACT_STORAGE,
	p5FactCapabilityHandlers,
	freezeP5Batch,
	freezeP5Bundle,
};

describe("backend P5 public exports", () => {
	it.each(Object.entries(publicP5Values))("re-exports %s by reference", (name, value) => {
		expect(Reflect.get(backend, name)).toBe(value);
	});

	it("exports the receipt store type", () => {
		expectTypeOf<backend.P5ReceiptStore>().toEqualTypeOf<P5ReceiptStore>();
	});

	it("exports the frozen snapshot types", () => {
		expectTypeOf<backend.FrozenP5Batch>().toEqualTypeOf<FrozenP5Batch>();
		expectTypeOf<backend.FrozenP5Bundle>().toEqualTypeOf<FrozenP5Bundle>();
	});

	it("keeps unlisted P5 entry points private", () => {
		for (const name of [
			"createP5ReceiptObserver",
			"p5FactSummary",
			"createP5HostDelivery",
			"createP5DecisionFacts",
			"createP5ComputeFacts",
			"createP5LocalFacts",
			"createP5TaskAcceptanceIssuer",
			"P5ByteStaging",
			"P5ByteTransaction",
			"p5ByteCapabilityHandlers",
			"createP5BatchExecutor",
			"createP5BatchLifecycle",
			"createP5BatchReviewer",
			"createP5BundleReviewer",
			"P5BundleReviewError",
			"P5_REVIEW_MAX_TEXT_BYTES",
			"createP5CriticHandler",
			"p5BundleCapability",
			"createP5RerunSubmitHandler",
			"p5RerunLifecycleHandlers",
		]) {
			expect(backend).not.toHaveProperty(name);
		}
		expect(
			Object.keys(backend)
				.filter((name) => /p5/i.test(name))
				.sort(),
		).toEqual(Object.keys(publicP5Values).sort());
	});
});
