import { existsSync } from "node:fs";
import { cp, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { createProcessPluginRuntime } from "../src/plugins/process-runtime";

const artifact = process.env.DRONE_INQUIRY_WASM_DIST;
const runtimeDirectory = resolve(
	process.env.DRONE_PLUGIN_RUNTIME_DIRECTORY ??
		join(import.meta.dirname, "../../desktop/plugin-runtime", `${process.platform}-${process.arch}`),
);
it.skipIf(!artifact || !existsSync(join(runtimeDirectory, "runtime.json")))(
	"runs the canonical WASM Inquiry SQL in an ordinary worker with Node SQLite disabled",
	async () => {
		const root = await realpath(await mkdtemp(join(tmpdir(), "inquiry-wasm-worker-")));
		let runtime;
		try {
			await cp(artifact, join(root, "dist"), { recursive: true });
			const entrypoint = join(root, "runtime.mjs");
			await writeFile(
				entrypoint,
				`import {readFile} from 'node:fs/promises';import {InquiryService} from './dist/domain.mjs';import {createInquiryWasmEngine} from './dist/wasm-storage.mjs';export default async()=>{const engine=await createInquiryWasmEngine(await readFile(new URL('./dist/sql-wasm.wasm',import.meta.url)));const store=engine.open('synthetic-workspace');const service=new InquiryService(store);return {operations:{exercise:{inputSchema:{type:'null'},resultSchema:{type:'object'},effect:'write',execute:async()=>{const date='2026-10-28T00:00:00.000Z';await service.recordQuestion({id:'synthetic-question',schemaVersion:2,projectId:'synthetic-workspace',kind:'hypothesis',statement:'Worker WASM question',competingExplanations:[],testsDone:[],testsPlanned:[],status:'open',proposer:'user',priority:1,createdAt:date,updatedAt:date});const snapshot=await store.snapshot();const bytes=await store.exportBytes();return {snapshot,base64:Buffer.from(bytes).toString('base64'),sqliteDisabled:process.execArgv.includes('--no-experimental-sqlite')};}}},dispose:()=>store.close()};};`,
			);
			runtime = await createProcessPluginRuntime({
				pluginId: "inquiry-candidate",
				packageRoot: root,
				entrypoint,
				runtimeDirectory,
			})({
				applicationId: "synthetic-app",
				signal: new AbortController().signal,
				resources: [],
				capabilities: {
					call: async () => {
						throw new Error("No host capability was granted");
					},
				},
				events: { changed() {} },
			});
			const result = await runtime.operations.exercise.execute(null, {
				scope: {
					kind: "session",
					workspaceId: "synthetic-workspace",
					workspaceDirectory: root,
					sessionId: "synthetic-session",
				},
				signal: new AbortController().signal,
				capabilities: {
					call: async () => {
						throw new Error("No host capability was granted");
					},
				},
			});
			expect(result.sqliteDisabled).toBe(true);
			expect(result.snapshot.questions).toMatchObject([
				{ id: "synthetic-question", statement: "Worker WASM question" },
			]);
			const bytes = Buffer.from(result.base64, "base64");
			expect(bytes.subarray(0, 16).toString()).toBe("SQLite format 3\0");
			// Only the test's own temporary output; not a production binary port.
			const output = join(root, "synthetic.sqlite");
			await writeFile(output, bytes);
			const { DatabaseSync } = await import("node:sqlite");
			const connection = new DatabaseSync(output);
			try {
				expect(connection.prepare("PRAGMA quick_check").get()).toMatchObject({ quick_check: "ok" });
			} finally {
				connection.close();
			}
		} finally {
			await runtime?.dispose();
			await rm(root, { recursive: true, force: true });
		}
	},
	30000,
);
