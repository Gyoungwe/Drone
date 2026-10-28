import { access, chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContainerSandboxRunner as ContainerKernelRunner } from "../src/container-sandbox";

let root: string;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "discovery-engine-test-"));
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
 if(mode==='success'){fs.unlinkSync(state);console.log('[summary] success');process.exit(0);}
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
	const instance = await ContainerKernelRunner.create({ projectRoot: root, runtime: "docker" });
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
