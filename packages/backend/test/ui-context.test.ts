import type { AskRequest } from "@drone/shared";
import { describe, expect, it, vi } from "vitest";
import type { PermissionGate } from "../src/permissions/gate";
import { AskGate } from "../src/session/ask-gate";
import { makeUiContext } from "../src/session/ui-context";

/** issue #28 回归：ctx.ui.theme 必须是契约 Theme 对象（方法可调用），不能是空对象/字符串 */
function fakeGate(): PermissionGate {
	return { confirm: async () => false } as unknown as PermissionGate;
}

describe("makeUiContext — ui.theme 契约", () => {
	it("theme 是对象且 fg/bg/bold 等样式方法全部可调用并返回字符串", () => {
		const ui = makeUiContext(fakeGate());
		// pi-mcp-adapter init.ts updateStatusBar 的实际用法：ui.theme ? theme.fg(...) : ...
		// 空对象/字符串会让 truthy 判断走进 .fg() 分支抛 TypeError（全部 MCP 服务器连接失败）
		expect(typeof ui.theme).toBe("object");
		expect(ui.theme).not.toBeNull();

		expect(ui.theme.fg("accent", "mcp: ready")).toContain("mcp: ready");
		expect(ui.theme.bg("selectedBg", "x")).toContain("x");
		expect(ui.theme.bold("x")).toContain("x");
		// 其余 Theme 方法也要存在（扩展可能调用任何一个；手写 pass-through 对象漏一个就崩）
		expect(ui.theme.italic("x")).toContain("x");
		expect(ui.theme.underline("x")).toContain("x");
		expect(ui.theme.inverse("x")).toContain("x");
		expect(ui.theme.strikethrough("x")).toContain("x");
		expect(typeof ui.theme.getFgAnsi("accent")).toBe("string");
		expect(typeof ui.theme.getBgAnsi("selectedBg")).toBe("string");
		expect(ui.theme.getColorMode()).toMatch(/truecolor|256color/);
		expect(typeof ui.theme.getThinkingBorderColor("high")).toBe("function");
	});

	it("所有 ThemeColor 枚举值都能被 fg() 接受（色表完整，不会运行时缺色）", () => {
		const ui = makeUiContext(fakeGate());
		const colors = [
			"accent",
			"border",
			"borderAccent",
			"borderMuted",
			"success",
			"error",
			"warning",
			"muted",
			"dim",
			"text",
			"thinkingText",
			"userMessageText",
			"customMessageText",
			"customMessageLabel",
			"toolTitle",
			"toolOutput",
			"mdHeading",
			"mdLink",
			"mdLinkUrl",
			"mdCode",
			"mdCodeBlock",
			"mdCodeBlockBorder",
			"mdQuote",
			"mdQuoteBorder",
			"mdHr",
			"mdListBullet",
			"toolDiffAdded",
			"toolDiffRemoved",
			"toolDiffContext",
			"syntaxComment",
			"syntaxKeyword",
			"syntaxFunction",
			"syntaxVariable",
			"syntaxString",
			"syntaxNumber",
			"syntaxType",
			"syntaxOperator",
			"syntaxPunctuation",
			"thinkingOff",
			"thinkingMinimal",
			"thinkingLow",
			"thinkingMedium",
			"thinkingHigh",
			"thinkingXhigh",
			"bashMode",
		] as const;
		for (const color of colors) {
			expect(ui.theme.fg(color, "t")).toContain("t");
		}
	});
});

describe("makeUiContext — native setup questions", () => {
	function bridge() {
		const send = vi.fn((_request: AskRequest) => true);
		const gate = new AskGate(send);
		gate.bindSession("setup-session");
		return { gate, send, ui: makeUiContext(fakeGate(), gate) };
	}

	it("input uses a text-only question and returns the custom answer", async () => {
		const { ui, gate, send } = bridge();
		const pending = ui.input("Vault path", "/path/to/Vault");
		const request = send.mock.calls[0][0];
		expect(request.sessionId).toBe("setup-session");
		expect(request.questions[0]).toMatchObject({ type: "text", options: [], prompt: "/path/to/Vault" });
		gate.respond(request.id, { kind: "answer", answers: { value: { customText: "  /my/Vault  " } } });
		await expect(pending).resolves.toBe("/my/Vault");
	});

	it("multiline selection keeps a short heading and the full proposal in the prompt", async () => {
		const { ui, gate, send } = bridge();
		const pending = ui.select("Apply setup\n\nWorkspace: /project\nVault: /vault", ["Apply", "Cancel"]);
		const request = send.mock.calls[0][0];
		expect(request.title).toBe("Apply setup");
		expect(request.questions[0].prompt).toContain("Workspace: /project");
		gate.respond(request.id, { kind: "answer", answers: { value: { values: ["Apply"] } } });
		await expect(pending).resolves.toBe("Apply");
	});

	it("cancellation does not invent an answer", async () => {
		const { ui, gate, send } = bridge();
		const pending = ui.input("Vault");
		gate.respond(send.mock.calls[0][0].id, { kind: "cancel" });
		await expect(pending).resolves.toBeUndefined();
	});

	it("forwards a selection abort to the ask gate", async () => {
		const { ui, send } = bridge();
		const controller = new AbortController();
		const pending = ui.select("Apply", ["Yes", "No"], { signal: controller.signal });
		expect(send).toHaveBeenCalledOnce();
		controller.abort();
		await expect(pending).resolves.toBeUndefined();
	});

	it("does not display input that was already aborted", async () => {
		const { ui, send } = bridge();
		const controller = new AbortController();
		controller.abort();
		await expect(ui.input("Vault", "", { signal: controller.signal })).resolves.toBeUndefined();
		expect(send).not.toHaveBeenCalled();
	});

	it("no question transport or no choices returns cancellation", async () => {
		const ui = makeUiContext(fakeGate());
		await expect(ui.input("Vault")).resolves.toBeUndefined();
		await expect(ui.select("Profile", [])).resolves.toBeUndefined();
	});
});

it("elaboration is not confirmation of an extension authorization", async () => {
	const requests: AskRequest[] = [];
	const gate = new AskGate((request) => requests.push(request));
	gate.bindSession("session");
	const ui = makeUiContext(fakeGate(), gate);
	const pending = ui.select("ask_user · 任务授权", ["暂不授权", "同意本次请求"]);
	gate.respond(requests[0]!.id, {
		kind: "answer",
		mode: "elaborate",
		answers: { value: { values: ["同意本次请求"] } },
	});
	expect(await pending).toBeUndefined();
	gate.dispose();
});
