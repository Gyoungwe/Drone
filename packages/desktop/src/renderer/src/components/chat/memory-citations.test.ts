import React from "react";
import { expect, it, vi } from "vitest";

vi.stubGlobal("React", React);

import { memoryCitations } from "./memory-citations";

it("collects [m:id] citations and memory_get ids, deduped in order", () => {
	expect(
		memoryCitations("用 apeglm 收缩 [m:12]，计数参数见 [m:3] 与 [m:12]。", [
			{ name: "memory_get", args: JSON.stringify({ ids: [3, 40] }) },
			{ name: "bash", args: JSON.stringify({ command: "echo 99" }) },
		]),
	).toEqual([12, 3, 40]);
	expect(memoryCitations("没有引用 [m:abc] [x:1]")).toEqual([]);
});

it("renders the citation row with ids", async () => {
	const { renderToStaticMarkup } = await import("react-dom/server");
	const { MemoryCitationRow } = await import("./MemoryCitationRow");
	const html = renderToStaticMarkup(
		React.createElement(MemoryCitationRow, { ids: [12, 3], label: "使用了 2 条记忆" }),
	);
	expect(html).toContain("使用了 2 条记忆");
	expect(html).toContain("m:12");
	expect(html).toContain("m:3");
});
