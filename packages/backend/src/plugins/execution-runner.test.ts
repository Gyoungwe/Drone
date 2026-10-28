import {
	access,
	chmod,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { ContainerSandboxRunner as ContainerKernelRunner } from "@gyoungwe/plugin-api/node/execution";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let root: string;
beforeEach(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), "discovery-engine-test-")));
	const executable = join(root, "docker");
	await writeFile(
		executable,
		`#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const root = process.env.DISCOVERY_ENGINE_TEST_ROOT;
const state = path.join(root,'state.json');
const args = process.argv.slice(2);
const mode = process.env.DISCOVERY_ENGINE_TEST_MODE;
fs.appendFileSync(path.join(root,'calls.jsonl'),JSON.stringify(args)+'\\n');
if(args[0]==='version'){console.log('synthetic-engine');process.exit(0);}
if(args[0]==='run'){
 const name=args[args.indexOf('--name')+1], label=args[args.indexOf('--label')+1].split('=')[1];
 fs.writeFileSync(state,JSON.stringify({name,label}));
 if(mode==='success'||mode==='lease-release-fail'){fs.unlinkSync(state);console.log('[summary] success');process.exit(0);}
 if(mode==='output'){fs.unlinkSync(state);process.stdout.write('😀'.repeat(20));process.stderr.write('x'.repeat(100));process.exit(0);}
 if(mode==='exit-fail'){process.exit(7);}
 setInterval(()=>{},1000);
} else if(args[0]==='inspect') {
 if(mode==='daemon-fail'||!fs.existsSync(state))process.exit(1);
 console.log(mode==='foreign'?'foreign-label':JSON.parse(fs.readFileSync(state)).label);
} else if(args[0]==='rm') {
 if(mode==='cleanup-fail')process.exit(1);
 if(fs.existsSync(state))fs.unlinkSync(state);
} else if(args[0]==='container'&&args[1]==='ls') {
 if(mode==='daemon-fail')process.exit(1);
 if(mode==='lease-release-fail')fs.chmodSync(path.join(root,'.test-execution-leases','execution-directories'),0o500);
 if(fs.existsSync(state))console.log(JSON.parse(fs.readFileSync(state)).name);
} else process.exit(2);
`,
	);
	await chmod(executable, 0o755);
	vi.stubEnv("PATH", `${root}${delimiter}${process.env.PATH}`);
	vi.stubEnv("DISCOVERY_ENGINE_TEST_ROOT", root);
	vi.stubEnv("DISCOVERY_ENGINE_TEST_MODE", "success");
});
afterEach(async () => {
	vi.unstubAllEnvs();
	await rm(root, { recursive: true, force: true });
});

const request = (signal?: AbortSignal, timeoutMs = 1000) => ({
	requestId: "request",
	language: "python" as const,
	code: 'print("synthetic")',
	runDirectory: "runs/test",
	timeoutMs,
	maxOutputBytes: 1024,
	dataClassification: "public" as const,
	signal,
});
async function runner() {
	const instance = await ContainerKernelRunner.create({
		projectRoot: root,
		runtime: "docker",
		reservationDirectory: join(root, ".test-execution-leases"),
	});
	if (!instance) throw new Error("Synthetic engine did not start");
	return instance;
}
const calls = async (): Promise<string[][]> =>
	(await readFile(join(root, "calls.jsonl"), "utf8"))
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
const started = () =>
	vi.waitFor(async () => {
		await access(join(root, "state.json"));
	});

describe("ContainerKernelRunner ownership and cleanup", () => {
	it("retains an execution-directory lease when its actual unlink fails after verified container cleanup", async () => {
		vi.stubEnv("DISCOVERY_ENGINE_TEST_MODE", "lease-release-fail");
		try {
			await expect((await runner()).run(request())).rejects.toMatchObject({
				code: "DISCOVERY_CLEANUP_FAILED",
			});
		} finally {
			await chmod(join(root, ".test-execution-leases", "execution-directories"), 0o700);
		}
		await expect((await runner()).run(request())).rejects.toThrow("already reserved");
	});
	it("rejects NUL code before creating a run directory or starting a container", async () => {
		await expect((await runner()).run({ ...request(), code: "print('x')\u0000" })).rejects.toThrow("NUL");
		await expect(access(join(root, "runs"))).rejects.toMatchObject({ code: "ENOENT" });
		expect((await calls()).some((args) => args[0] === "run")).toBe(false);
	});
	it("excludes another real runner from the same run directory until verified cancellation cleanup", async () => {
		vi.stubEnv("DISCOVERY_ENGINE_TEST_MODE", "hold");
		const abort = new AbortController();
		const first = (await runner()).run(request(abort.signal));
		const firstRejected = expect(first).rejects.toThrow("cancel first owner");
		await started();
		await expect((await runner()).run(request())).rejects.toThrow("already reserved");
		abort.abort(new Error("cancel first owner"));
		await firstRejected;
		vi.stubEnv("DISCOVERY_ENGINE_TEST_MODE", "success");
		expect((await (await runner()).run(request())).exitCode).toBe(0);
	});
	it("bounds combined stdout/stderr by UTF-8 bytes while preserving the actual produced count", async () => {
		vi.stubEnv("DISCOVERY_ENGINE_TEST_MODE", "output");
		const result = await (await runner()).run({ ...request(), maxOutputBytes: 65 });
		expect(result.producedBytes).toBe(180);
		expect(
			result.outputs.reduce((total, output) => total + Buffer.byteLength(output.text), 0),
		).toBeLessThanOrEqual(65);
		expect(result.outputs.every((output) => !output.text.includes("�"))).toBe(true);
	});
	for (const nested of [false, true]) {
		it(`rejects ${nested ? "nested" : "top-level"} runs symlinks before creating files or starting a container`, async () => {
			const outside = await mkdtemp(join(tmpdir(), "sandbox-outside-"));
			try {
				if (nested) await mkdir(join(root, "runs"));
				await symlink(outside, join(root, "runs", ...(nested ? ["nested"] : [])));
				const instance = await runner();
				await expect(
					instance.run({ ...request(), runDirectory: nested ? "runs/nested/escaped" : "runs/escaped" }),
				).rejects.toThrow("symlink");
				expect(await readdir(outside)).toEqual([]);
				expect((await calls()).some((args) => args[0] === "run")).toBe(false);
			} finally {
				await rm(outside, { recursive: true, force: true });
			}
		});
	}
	it("successful execution verifies absence through a responsive daemon", async () => {
		const result = await (await runner()).run(request());
		expect(result.exitCode).toBe(0);
		const history = await calls();
		expect(history.find((args) => args[0] === "container")).toContain("ls");
		await expect(access(join(root, "state.json"))).rejects.toMatchObject({ code: "ENOENT" });
	});
	it("abort waits for CLI exit, removes only its exact labelled container and reads absence", async () => {
		vi.stubEnv("DISCOVERY_ENGINE_TEST_MODE", "hold");
		const controller = new AbortController();
		const pending = (await runner()).run(request(controller.signal));
		const rejected = expect(pending).rejects.toThrow("requested abort");
		await started();
		const owned = JSON.parse(await readFile(join(root, "state.json"), "utf8"));
		controller.abort(new Error("requested abort"));
		await rejected;
		const history = await calls();
		expect(history.find((args) => args[0] === "rm")).toEqual(["rm", "--force", owned.name]);
		expect(history.at(-1)?.[0]).toBe("container");
		await expect(access(join(root, "state.json"))).rejects.toMatchObject({ code: "ENOENT" });
	});
	it("timeout removes and verifies the owned container before rejecting", async () => {
		vi.stubEnv("DISCOVERY_ENGINE_TEST_MODE", "hold");
		await expect((await runner()).run(request(undefined, 500))).rejects.toThrow("container-timeout");
		await expect(access(join(root, "state.json"))).rejects.toMatchObject({ code: "ENOENT" });
		expect((await calls()).some((args) => args[0] === "rm")).toBe(true);
	});
	it("nonzero execution still cleans its resource while retaining the failed exit code", async () => {
		vi.stubEnv("DISCOVERY_ENGINE_TEST_MODE", "exit-fail");
		expect((await (await runner()).run(request())).exitCode).toBe(7);
		await expect(access(join(root, "state.json"))).rejects.toMatchObject({ code: "ENOENT" });
	});
	it.each(["cleanup-fail", "daemon-fail", "foreign"])(
		"%s remains DISCOVERY_CLEANUP_FAILED instead of reporting a successful close",
		async (mode) => {
			vi.stubEnv("DISCOVERY_ENGINE_TEST_MODE", mode);
			const controller = new AbortController();
			const pending = (await runner()).run(request(controller.signal));
			const rejected = expect(pending).rejects.toMatchObject({ code: "DISCOVERY_CLEANUP_FAILED" });
			await started();
			controller.abort();
			await rejected;
			await expect(access(join(root, "state.json"))).resolves.toBeUndefined();
			if (mode === "foreign") expect((await calls()).some((args) => args[0] === "rm")).toBe(false);
		},
	);
});
