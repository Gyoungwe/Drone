// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

/**
 * Z1d — the composition releases what it built when a provider refuses.
 *
 * The two P5 providers are composed into one activation.  The byte provider
 * can refuse the activation — the user cancels the directory picker — and at
 * that point the reads provider has already been built.  A provider that
 * refuses must not leave the other one holding an open store.
 *
 * The test observes the *disposal* itself, by replacing the providers with
 * ones whose disposal is observable.  A test that only checks the thrown
 * error would pass whether or not the store was released.
 */

const providers = vi.hoisted(() => ({
	receiptsDispose: vi.fn(async () => undefined),
	bytesDispose: vi.fn(async () => undefined),
	bytesBuild: vi.fn(),
}));

vi.mock("./p5-runtime-capabilities", () => ({
	createP5RuntimeCapabilities: () => () => async () => ({
		resources: [],
		handlers: { "receipts.read": { execute: async () => ({}) } },
		dispose: providers.receiptsDispose,
	}),
}));

vi.mock("./p5-byte-runtime-capabilities", () => ({
	createP5ByteRuntimeCapabilities: () => () => async () => {
		providers.bytesBuild();
		return {
			resources: [],
			handlers: { "bytes.write": { execute: async () => ({}) } },
			dispose: providers.bytesDispose,
		};
	},
}));

import { composeP5Capabilities } from "./p5-capability-composition";

const source = {
	pluginId: "@example/index",
	packageRoot: "/tmp",
	entrypoint: "/tmp/runtime.js",
	contentHash: "b".repeat(64),
} as never;

const activation = {
	pluginId: "@example/index",
	applicationId: "app",
	signal: new AbortController().signal,
	events: { changed: vi.fn() },
} as never;

const options = {
	userDataDir: "/tmp",
	profileDirectory: "/tmp",
	storageRegistry: {} as never,
	getSessionContext: () => undefined,
	selectStagedOutputDirectory: async () => ["/tmp"],
};

describe("the P5 capability composition", () => {
	it("releases the reads when the byte provider refuses the activation", async () => {
		providers.receiptsDispose.mockClear();
		providers.bytesDispose.mockClear();
		providers.bytesBuild.mockClear();
		// Make the byte provider refuse, the way a cancelled picker does.
		providers.bytesBuild.mockImplementation(() => {
			throw new Error("P5 staged output directory selection was canceled");
		});

		await expect(composeP5Capabilities(options, source, activation)).rejects.toThrow(/canceled/i);
		// The reads provider was built first, so it owns an open store and
		// must be released before the refusal is passed on.
		expect(providers.receiptsDispose).toHaveBeenCalledTimes(1);
	});

	it("releases both providers on the ordinary path", async () => {
		providers.receiptsDispose.mockClear();
		providers.bytesDispose.mockClear();
		providers.bytesBuild.mockImplementation(() => undefined);
		const composition = await composeP5Capabilities(options, source, activation);
		await composition.dispose();
		expect(providers.receiptsDispose).toHaveBeenCalledTimes(1);
		expect(providers.bytesDispose).toHaveBeenCalledTimes(1);
	});
});
