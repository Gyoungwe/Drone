import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// resources/ 下是随包分发的技能/插件源码（research-skills 由 sync 脚本生成、git-ignored），
		// 其中的 *.test.mjs 是 node:test 用例，不归 vitest 跑；只收 src/ 与 scripts/ 下的测试。
		exclude: [...configDefaults.exclude, "resources/**", "out/**"],
	},
});
