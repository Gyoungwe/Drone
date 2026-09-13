import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ModelPrefsService } from "../src/settings/model-prefs";

async function makeService() {
	const dir = await mkdtemp(join(tmpdir(), "percho-model-prefs-"));
	return {
		dir,
		path: join(dir, "model-prefs.json"),
		service: new ModelPrefsService(join(dir, "model-prefs.json")),
	};
}

describe("ModelPrefsService", () => {
	it("读写隐藏模型与子代理模型，删除配置后回到继承", async () => {
		const { service } = await makeService();
		expect(await service.getPrefs()).toEqual({ hiddenModels: {}, subagentModels: {}, subagentThinking: {} });
		await service.setModelHidden("deepseek", "v4-flash", true);
		await service.setSubagentModel("scout", "deepseek/v4-flash");
		await service.setSubagentThinking("scout", "high");
		expect(await service.getPrefs()).toEqual({
			hiddenModels: { deepseek: ["v4-flash"] },
			subagentModels: { scout: "deepseek/v4-flash" },
			subagentThinking: { scout: "high" },
		});
		await service.setModelHidden("deepseek", "v4-flash", false);
		await service.setSubagentModel("scout", null);
		await service.setSubagentThinking("scout", null);
		expect(await service.getPrefs()).toEqual({ hiddenModels: {}, subagentModels: {}, subagentThinking: {} });
	});

	it("拒绝非法 Thinking 档位并规整旧文件", async () => {
		const { path, service } = await makeService();
		await writeFile(
			path,
			JSON.stringify({ subagentThinking: { scout: "ultra", reviewer: "medium" } }),
			"utf8",
		);
		expect((await service.getPrefs()).subagentThinking).toEqual({ reviewer: "medium" });
		await expect(service.setSubagentThinking("scout", "ultra" as never)).rejects.toThrow(
			"invalid subagent thinking level",
		);
	});

	it("原子写不遗留临时文件", async () => {
		const { dir, service } = await makeService();
		await service.setModelHidden("p", "m", true);
		expect((await readdir(dir)).sort()).toEqual(["model-prefs.json"]);
	});

	it("损坏文件安全回退为空配置", async () => {
		const { path, service } = await makeService();
		await writeFile(path, "{broken", "utf8");
		expect(await service.getPrefs()).toEqual({ hiddenModels: {}, subagentModels: {}, subagentThinking: {} });
	});
});
