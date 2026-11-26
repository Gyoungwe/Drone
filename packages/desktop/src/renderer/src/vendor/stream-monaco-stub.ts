/**
 * 在构建期替代 Markdown 渲染器的可选编辑器模块，避免打入编辑器和 worker。
 * 预加载入口为空操作，代码块由 Shiki 渲染。
 */
export const preloadMonacoWorkers = async (): Promise<void> => undefined;
export default {};
