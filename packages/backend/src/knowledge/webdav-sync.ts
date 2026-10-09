import { readKnowledgeBinding } from "@drone/knowledge/config";
import { readNoteFile } from "@drone/knowledge/files";
import { containedVaultFile, createVaultFileOnly } from "@drone/knowledge/layout";
import type { KnowledgeApi, KnowledgeCloudSyncItem, KnowledgeCloudSyncResult } from "@drone/shared";
import type { KnowledgeWebDavService } from "./webdav";
import { cloudError, cloudNotePath, KnowledgeWebDavError } from "./webdav-transport";

/** 首期仅传输明确列出的笔记。已有不同内容保持双端原样，不维护隐式基线或重试队列。 */
export async function syncCloudNotes(
	cloud: Pick<KnowledgeWebDavService, "read" | "write">,
	input: Parameters<KnowledgeApi["syncKnowledgeCloud"]>[0],
): Promise<KnowledgeCloudSyncResult> {
	if (
		!Array.isArray(input.paths) ||
		!input.paths.length ||
		input.paths.length > 64 ||
		!["pull", "push"].includes(input.mode)
	)
		throw new KnowledgeWebDavError("protocol", "每次同步需选择 1–64 篇笔记和有效方向");
	const paths = [...new Set(input.paths.map(cloudNotePath))];
	const binding = await readKnowledgeBinding({ fresh: true });
	if (!binding || binding.revision !== input.bindingRevision)
		throw new KnowledgeWebDavError("conflict", "本地知识库绑定已变化，请刷新后重新选择笔记");
	const checkBinding = async () => {
		const current = await readKnowledgeBinding({ fresh: true });
		if (current?.vaultId !== binding.vaultId || current?.revision !== binding.revision)
			throw new KnowledgeWebDavError("conflict", "本地知识库绑定已变化，已停止该笔记同步");
	};
	const items: KnowledgeCloudSyncItem[] = [];
	for (const path of paths) {
		let localHash: string | null = null;
		let remoteVersion: string | null = null;
		try {
			await checkBinding();
			let local: Awaited<ReturnType<typeof readNoteFile>> | null = null;
			try {
				local = await readNoteFile(binding.vault, path);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
			localHash = local?.hash ?? null;
			let remote: Awaited<ReturnType<KnowledgeWebDavService["read"]>> | null = null;
			try {
				remote = await cloud.read(path);
			} catch (error) {
				if (!(error instanceof KnowledgeWebDavError) || error.code !== "not_found") throw error;
			}
			remoteVersion = remote?.version ?? null;
			await checkBinding();
			let status: KnowledgeCloudSyncItem["status"];
			let message: string | null = null;
			if (local && remote && local.hash === remote.hash) status = "unchanged";
			else if (local && remote) {
				status = "conflict";
				message = "两端内容不同，已保留原文；请先人工核对";
			} else if (input.mode === "push" && local) {
				// 读取云端可能耗时；提交前核对本地仍是同一份正文。
				if ((await readNoteFile(binding.vault, path)).hash !== local.hash)
					throw new KnowledgeWebDavError("conflict", "本地笔记在同步期间发生变化，请重新同步");
				await checkBinding();
				const result = await cloud.write({ path, text: local.text });
				status =
					result.status === "created" ? "pushed" : result.status === "conflict" ? "conflict" : "failed";
				remoteVersion = result.version;
				message = result.message;
			} else if (input.mode === "pull" && remote) {
				const target = await containedVaultFile(binding.vault, path);
				await checkBinding();
				const created = await createVaultFileOnly(target, remote.text);
				status = created ? "pulled" : "conflict";
				localHash = created ? remote.hash : null;
				message = created ? "已保存所读云端版本；本地索引尚待更新" : "本地笔记在同步期间出现，未覆盖";
			} else {
				status = "skipped";
				message = "所选方向的源笔记不存在；不会传播删除";
			}
			items.push({ path, status, localHash, remoteVersion, message });
		} catch (error) {
			items.push({
				path,
				status: error instanceof KnowledgeWebDavError && error.code === "conflict" ? "conflict" : "failed",
				localHash,
				remoteVersion,
				message: cloudError(error),
			});
		}
	}
	return {
		mode: input.mode,
		completed: items.every((item) => ["unchanged", "pulled", "pushed"].includes(item.status)),
		items,
		warnings: [
			"本次结果只对应已选择的笔记与读取版本，不代表整个知识库已同步或可实时检索。离线不排队，冲突不自动覆盖。",
		],
	};
}
