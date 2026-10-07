import { createTaskWorkbench } from "@drone/tasks/workbench";
import { expect, it } from "vitest";

// 会话 01a11779：浏览器 MCP 没加载，模型改写 packages/desktop/.pi/mcp.json 后把「写配置」当作验收完成。
function plan(path) {
	const j = createTaskWorkbench();
	j.attach("scope-mcp-config");
	j.begin("用浏览器打开网页");
	return () =>
		j.plan({
			goal: "用浏览器打开网页",
			summary: "摘要",
			milestones: [
				{ id: "m1", title: "接入浏览器", acceptance: { kind: "file", path, rootKind: "workspace" } },
			],
		});
}
it.each([".pi/mcp.json", "C:\\proj\\.mcp.json", "mcp.json", ".pi/mcp-adapter.json"])(
	"a written %s cannot be the acceptance of a milestone",
	(path) => {
		expect(plan(path)).toThrow(/does not load MCP tools/);
	},
);
it("other files still work as file acceptance", () => {
	expect(plan("report/mcp-notes.md")).not.toThrow();
	expect(plan("screenshot.png")).not.toThrow();
});
