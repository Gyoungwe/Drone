import { createTaskWorkbench } from "@drone/tasks/workbench";
import { afterEach, expect, it } from "vitest";

// 宿主拦截文案进入工具卡片：中文界面先给中文说明，英文契约原文保留（模型与 process-lanes 依赖它）。
const saved = process.env.DRONE_REPLY_LANGUAGE;
afterEach(() => {
	if (saved === undefined) delete process.env.DRONE_REPLY_LANGUAGE;
	else process.env.DRONE_REPLY_LANGUAGE = saved;
});

function blockedReason() {
	const j = createTaskWorkbench();
	j.attach("scope-host-language");
	return j.guard({ toolName: "bash", input: { command: "ls" } });
}

it("unauthorized-task block is bilingual for the Chinese UI", () => {
	process.env.DRONE_REPLY_LANGUAGE = "zh";
	const result = blockedReason();
	expect(result).toMatchObject({ block: true });
	const [zh, en] = result.reason.split("\n");
	expect(zh).toMatch(/^还没有获批的任务方案：.*task_plan.*弹窗中批准/);
	expect(en).toMatch(/^No authorized task contract exists\./);
});

it("stays English-only otherwise", () => {
	delete process.env.DRONE_REPLY_LANGUAGE;
	expect(blockedReason().reason).toMatch(/^No authorized task contract exists\./);
	process.env.DRONE_REPLY_LANGUAGE = "en";
	expect(blockedReason().reason).not.toMatch(/[\u4e00-\u9fff]/);
});
