import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { PluginRuntimeBridge, type PluginRuntimeBridgeOptions } from "../plugins/coordinator";
import { SessionRegistry } from "../session/registry";
import type { PackageLocation, PackageReplacementHost, PackageSelection } from "./package-replacement";
import { PackageService } from "./packages";

const name = "@example/worker";
const previous = {
	entry: { source: `npm:${name}@1.0.0`, autoload: false, extensions: ["+extension.mjs"] },
	dependency: "1.0.0",
};
const oldBytes = "exact bytes from the previously verified worker\n";

async function writePackage(directory: string, version: string, code: string, packageName = name) {
	await mkdir(directory, { recursive: true });
	await writeFile(join(directory, "package.json"), JSON.stringify({ name: packageName, version }));
	await writeFile(join(directory, "runtime.mjs"), code);
}

function fixture(root: string) {
	const modules = join(root, "npm", "node_modules");
	const live = join(modules, name);
	const settings = join(root, "selection.json");
	const read = (): PackageSelection =>
		existsSync(settings) ? JSON.parse(readFileSync(settings, "utf8")) : {};
	const configure = vi.fn(async (expected: PackageSelection, selected: PackageSelection) => {
		expect(read()).toEqual(expected);
		await writeFile(settings, JSON.stringify(selected));
	});
	const stage = vi.fn(async (directory: string) => {
		await writePackage(join(directory, "npm", "node_modules", name), "2.0.0", "candidate bytes\n");
	});
	const manager = {
		listConfiguredPackages: () => (read().entry ? [{ source: `npm:${name}`, scope: "user" as const }] : []),
		getInstalledPath: () => (existsSync(live) ? live : undefined),
		installAndPersist: vi.fn(async () => undefined),
		update: vi.fn(async () => undefined),
		removeAndPersist: vi.fn(async () => true),
		prepareReplacement: async () => ({ modules, stage, read, configure }),
	};
	const drain = vi.fn(async () => true);
	const quarantine = vi.fn();
	const host = {
		inspect: vi.fn<PackageReplacementHost["inspect"]>(async (location: PackageLocation) => ({
			sources: [
				{ pluginId: name, packageRoot: location.path, entrypoint: join(location.path, "runtime.mjs") },
			],
		})),
		transition: async (_location, _sources, action) => action(await drain(), quarantine),
		probe: vi.fn(async () => undefined),
		rescan: vi.fn(async () => undefined),
	} satisfies PackageReplacementHost;
	const service = new PackageService({
		registry: new SessionRegistry(),
		packageManagerFactory: () => manager,
	});
	return { service, host, live, stage, drain, quarantine, settings, read, configure };
}

function deferred() {
	let resolve: () => void = () => {
		throw new Error("Promise resolver was not initialized");
	};
	const promise = new Promise<void>((complete) => {
		resolve = complete;
	});
	return { promise, resolve };
}

function bindFixture(state: ReturnType<typeof fixture>, factory: PluginRuntimeBridgeOptions["factory"]) {
	const requested = deferred();
	const bridge = new PluginRuntimeBridge({
		factory,
		source: (pluginId) => ({
			pluginId,
			packageRoot: pluginId === name ? state.live : `${state.live}-peer`,
			entrypoint: "fixture",
		}),
		enabled: () => true,
		approve: async () => true,
		getSessionContext: () => undefined,
	});
	const window = { id: 1, isDestroyed: () => false };
	state.host.transition = (location, _sources, action) => {
		const result = bridge.withPackageTransition(
			location.path,
			(source) => source.packageRoot === location.path,
			window,
			action,
		);
		requested.resolve();
		return result;
	};
	return { bridge, window, requested: requested.promise };
}

function testReplacement(label: string, run: (state: ReturnType<typeof fixture>) => Promise<void>) {
	it(label, async () => {
		const root = await realpath(await mkdtemp(join(tmpdir(), "drone-package-replacement-")));
		try {
			await run(fixture(root));
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
}

async function installed(state: ReturnType<typeof fixture>) {
	await writePackage(state.live, "1.0.0", oldBytes);
	await writeFile(state.settings, JSON.stringify(previous));
}

testReplacement(
	"keeps the failed update and reads back the exact old selection after candidate rejection",
	async (state) => {
		await installed(state);
		state.host.probe.mockRejectedValueOnce(new Error(`${state.live} ${"guest output ".repeat(250)}`));

		const receipt = await state.service.updatePackage(name, state.host);

		expect(receipt).toMatchObject({
			status: "failed",
			previousVersion: "1.0.0",
			version: "1.0.0",
			error: { code: "operation-failed", message: "Candidate worker readiness failed" },
		});
		expect(receipt.events.map(({ type }) => type)).toEqual([
			"staged",
			"verified",
			"drained",
			"failed",
			"rolled_back",
		]);
		expect(state.read()).toEqual(previous);
		expect(readFileSync(join(state.live, "runtime.mjs"), "utf8")).toBe(oldBytes);
		expect(JSON.stringify(receipt)).not.toMatch(/guest output|drone-package-replacement/);
	},
);

testReplacement("publishes healthy v2 only after readiness while preserving SDK filters", async (state) => {
	await installed(state);
	state.host.probe.mockImplementationOnce(async () => {
		expect(state.read()).toEqual(previous);
		expect(readFileSync(join(state.live, "runtime.mjs"), "utf8")).toBe(oldBytes);
	});
	const receipt = await state.service.updatePackage(name, state.host);
	expect(receipt).toMatchObject({ status: "succeeded", previousVersion: "1.0.0", version: "2.0.0" });
	expect(receipt.events.map(({ type }) => type)).toEqual(["staged", "verified", "drained", "enabled"]);
	expect(state.read()).toEqual({
		entry: { ...previous.entry, source: `npm:${name}` },
		dependency: "2.0.0",
	});
	expect(readFileSync(join(state.live, "runtime.mjs"), "utf8")).toBe("candidate bytes\n");
});

testReplacement(
	"reports the app restart boundary for changed boot-loaded code after readback",
	async (state) => {
		await installed(state);
		state.host.inspect.mockResolvedValue({ sources: [], restart: true });
		const receipt = await state.service.updatePackage(name, state.host);
		expect(receipt).toMatchObject({
			status: "succeeded",
			effect: "app-restart",
			previousVersion: "1.0.0",
			version: "2.0.0",
		});
		expect(receipt.events.map(({ type }) => type)).toEqual(["staged", "verified", "enabled"]);
		expect(state.read().dependency).toBe("2.0.0");
		expect(state.drain).not.toHaveBeenCalled();
	},
);

testReplacement(
	"rejects a staged package with the wrong identity before touching the prior worker",
	async (state) => {
		await installed(state);
		state.stage.mockImplementationOnce((directory) =>
			writePackage(join(directory, "npm", "node_modules", name), "2.0.0", "wrong bytes", "another-package"),
		);
		const receipt = await state.service.updatePackage(name, state.host);
		expect(receipt.error?.message).toBe("Candidate package staging or integrity verification failed");
		expect(receipt.events.map(({ type }) => type)).toEqual(["staged", "failed"]);
		expect(state.drain).not.toHaveBeenCalled();
		expect(state.read()).toEqual(previous);
		expect(readFileSync(join(state.live, "runtime.mjs"), "utf8")).toBe(oldBytes);
	},
);

testReplacement("rejects a candidate changed during verification before draining", async (state) => {
	await installed(state);
	const inspect = state.host.inspect.getMockImplementation();
	if (!inspect) throw new Error("Expected installed source inspection");
	state.host.inspect.mockImplementation(async (location) => {
		const seen = await inspect(location);
		if (location.path !== state.live) await writeFile(join(location.path, "runtime.mjs"), "changed bytes");
		return seen;
	});
	const receipt = await state.service.updatePackage(name, state.host);
	expect(receipt.events.map(({ type }) => type)).toEqual(["staged", "failed"]);
	expect(state.drain).not.toHaveBeenCalled();
	expect(state.read()).toEqual(previous);
});

testReplacement("keeps the old selection when teardown cannot confirm lease release", async (state) => {
	await installed(state);
	state.drain.mockRejectedValueOnce(new Error("guest shutdown failed"));
	const receipt = await state.service.updatePackage(name, state.host);
	expect(receipt.error?.message).toBe("Previous worker did not drain safely");
	expect(receipt.events.map(({ type }) => type)).toEqual(["staged", "verified", "failed"]);
	expect(state.host.probe).not.toHaveBeenCalled();
	expect(state.configure).not.toHaveBeenCalled();
	expect(state.read()).toEqual(previous);
});

testReplacement("reads back absence after the first worker fails readiness", async (state) => {
	state.drain.mockResolvedValueOnce(false);
	state.host.probe.mockRejectedValueOnce(new Error("invalid readiness result"));
	const receipt = await state.service.installPackage(name, state.host);
	expect(receipt).toMatchObject({ status: "failed", error: { code: "operation-failed" } });
	expect(receipt.events.map(({ type }) => type)).toEqual(["staged", "verified", "failed", "rolled_back"]);
	expect(receipt.version).toBeUndefined();
	expect(state.read()).toEqual({});
	expect(existsSync(state.live)).toBe(false);
	expect(existsSync(state.settings)).toBe(false);
});

testReplacement("restores the exact prior bytes and source after publication fails", async (state) => {
	await installed(state);
	state.host.rescan.mockRejectedValueOnce(new Error("could not publish selected package"));
	const receipt = await state.service.updatePackage(name, state.host);
	expect(receipt).toMatchObject({ status: "failed", version: "1.0.0" });
	expect(receipt.events.at(-1)?.type).toBe("rolled_back");
	expect(state.configure).toHaveBeenCalledTimes(2);
	expect(state.host.rescan).toHaveBeenCalledTimes(2);
	expect(state.read()).toEqual(previous);
	expect(readFileSync(join(state.live, "runtime.mjs"), "utf8")).toBe(oldBytes);
});

testReplacement("waits for an adopted owner and then for its accepted work to settle", async (state) => {
	await installed(state);
	const entered = deferred();
	const finish = deferred();
	const dispose = vi.fn(async () => undefined);
	const { bridge, window, requested } = bindFixture(state, () => async () => ({
		operations: {
			write: {
				inputSchema: { type: "null" },
				resultSchema: { type: "null" },
				effect: "write",
				execute: async () => {
					entered.resolve();
					await finish.promise;
					return null;
				},
			},
		},
		dispose,
	}));
	const session = { ...window, id: 2, isSessionBound: () => true };
	const token = await bridge.bind(name, session);
	if (!token) throw new Error("Expected session binding");
	const selection = bridge.selectSession(session, null);
	const write = bridge.invoke(session, token, "write", null, selection);
	const canceled = expect(write).rejects.toThrow();
	await entered.promise;
	const update = state.service.updatePackage(name, state.host);
	await requested;
	await expect(bridge.bind(name, window)).rejects.toThrow("unavailable");
	expect(dispose).not.toHaveBeenCalled();
	const shutdown = bridge.revoke(name, session.id);
	expect(state.host.probe).not.toHaveBeenCalled();
	expect(state.read()).toEqual(previous);
	finish.resolve();
	await Promise.all([canceled, shutdown]);
	await expect(update).resolves.toMatchObject({ status: "succeeded", version: "2.0.0" });
	expect(dispose).toHaveBeenCalledOnce();
	await bridge.close();
});

testReplacement(
	"keeps a failed teardown quarantined across subsequent binds and replacements",
	async (state) => {
		await installed(state);
		const dispose = vi.fn(async () => {
			throw new Error("worker shutdown timed out");
		});
		const { bridge, window } = bindFixture(state, () => async () => ({ operations: {}, dispose }));
		await bridge.bind(name, window);
		const update = await state.service.updatePackage(name, state.host);
		expect(update.error?.message).toBe("Previous worker did not drain safely");
		await expect(bridge.bind(name, window)).rejects.toThrow("disposal failed");
		await expect(state.service.updatePackage(name, state.host)).resolves.toMatchObject({ status: "failed" });
		expect(state.host.probe).not.toHaveBeenCalled();
		expect(state.read()).toEqual(previous);
		expect(dispose).toHaveBeenCalledOnce();
		await expect(bridge.close()).rejects.toThrow("shutdown failed");
	},
);
