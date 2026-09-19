import { tmpdir } from "node:os";
import { join } from "node:path";
import researchLoop from "../../../.pi/extensions/research-loop.mjs";
import sourceArchive from "../../../.pi/extensions/source-archive.mjs";
import zoteroLiterature from "../../../.pi/extensions/zotero-literature.mjs";
import { registerKnowledgeInterface } from "../../../.pi/lib/knowledge/extension.mjs";

/**
 * 测试夹具（挂钩 1）：工具清单没有名字表，只读 / 回执日志 / 只读恢复 / 卡片构造器都来自扩展
 * 在 registerTool 时的 drone 声明。单元测试若绕过扩展直接驱动回执日志、能力运行时或
 * KnowledgeFlow，需要先让真实扩展把声明登记进进程级清单——这里用一个只捕获 registerTool、
 * 其余 API 全部 no-op 的 pi 桩完成，不做任何 IO。
 */
export function stubPi(tools = new Map()) {
	const noop = () => {};
	return {
		registerTool: (tool) => tools.set(tool.name, tool),
		registerCommand: noop,
		registerMessageRenderer: noop,
		on: noop,
		appendEntry: noop,
		sendMessage: noop,
		getCommands: () => [],
		events: { on: noop, emit: async () => {} },
	};
}

let registered = null;
/** 登记研究扩展（知识接口 / 来源归档 / 证据回路 / Zotero）的工具声明；幂等。 */
export function registerResearchToolMeta() {
	if (registered) return registered;
	const tools = new Map();
	// 知识接口只有在桌面知识目录存在时才注册工具；登记声明不做 IO，临时给一个绝对路径即可
	const previous = process.env.DRONE_KNOWLEDGE_DIR;
	process.env.DRONE_KNOWLEDGE_DIR = previous || join(tmpdir(), "drone-tool-manifest-fixture");
	try {
		registerKnowledgeInterface(stubPi(tools), { readOnly: true });
	} finally {
		if (previous === undefined) delete process.env.DRONE_KNOWLEDGE_DIR;
		else process.env.DRONE_KNOWLEDGE_DIR = previous;
	}
	sourceArchive(stubPi(tools));
	researchLoop(stubPi(tools));
	zoteroLiterature(stubPi(tools));
	registered = tools;
	return tools;
}
