import { readKnowledgeBinding } from "@drone/knowledge/config";
import { readNoteFile } from "@drone/knowledge/files";
import {
	containedVaultFile,
	createVaultFileOnly,
	replaceVaultFile,
	VaultFileConflictError,
} from "@drone/knowledge/layout";
import type {
	KnowledgeApi,
	KnowledgeCloudSyncItem,
	KnowledgeCloudSyncPreview,
	KnowledgeCloudSyncResult,
} from "@drone/shared";
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
	if (!Array.isArray(input.previews) || input.previews.length !== paths.length)
		throw new KnowledgeWebDavError("conflict", "同步必须基于最新预览；请重新读取所选笔记");
	const previews = new Map<string, KnowledgeCloudSyncPreview>();
	for (const preview of input.previews) {
		const path = cloudNotePath(preview.path);
		if (!paths.includes(path) || previews.has(path))
			throw new KnowledgeWebDavError("protocol", "同步预览与所选笔记不一致");
		previews.set(path, { ...preview, path });
	}
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
		const preview = previews.get(path);
		if (!preview) throw new KnowledgeWebDavError("protocol", "同步预览缺少所选笔记");
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
			if (
				localHash !== preview.localHash ||
				(remote?.hash ?? null) !== preview.remoteHash ||
				remoteVersion !== preview.remoteVersion
			)
				throw new KnowledgeWebDavError("conflict", "笔记在预览后发生变化，请重新预览后再同步");
			let status: KnowledgeCloudSyncItem["status"];
			let message: string | null = null;
			if (local && remote && local.hash === remote.hash) status = "unchanged";
			else if (local && remote) {
				if (input.resolution === "local" && input.mode === "push") {
					if (!remote.version) {
						status = "conflict";
						message = "云端未返回强 ETag，无法安全覆盖；请重新读取后人工处理";
					} else {
						if ((await readNoteFile(binding.vault, path)).hash !== local.hash)
							throw new KnowledgeWebDavError("conflict", "本地笔记在冲突处理期间发生变化，请重新预览");
						await checkBinding();
						const result = await cloud.write({ path, text: local.text, expectedVersion: remote.version });
						status =
							result.status === "updated" ? "pushed" : result.status === "conflict" ? "conflict" : "failed";
						remoteVersion = result.version;
						message = result.message ?? "已用本地版本更新云端";
					}
				} else if (input.resolution === "remote" && input.mode === "pull") {
					if (!remote.version || !preview.remoteVersion)
						throw new KnowledgeWebDavError(
							"conflict",
							"云端未返回强 ETag，无法安全覆盖本地；请重新读取后人工处理",
						);
					if ((await readNoteFile(binding.vault, path)).hash !== local.hash)
						throw new KnowledgeWebDavError("conflict", "本地笔记在冲突处理期间发生变化，请重新预览");
					const target = await containedVaultFile(binding.vault, path);
					await checkBinding();
					try {
						await replaceVaultFile(target, remote.text, { expectedHash: preview.localHash ?? local.hash });
					} catch (error) {
						if (error instanceof VaultFileConflictError)
							throw new KnowledgeWebDavError("conflict", "本地笔记在写入前发生变化，未覆盖新编辑");
						throw error;
					}
					status = "pulled";
					localHash = remote.hash;
					message = "已用云端版本覆盖本地笔记；本地索引尚待更新";
				} else {
					status = "conflict";
					message = "两端内容不同，已保留原文；请先人工核对";
				}
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
				if (!remote.version || !preview.remoteVersion)
					throw new KnowledgeWebDavError("conflict", "云端未返回强 ETag，无法安全取回；请重新读取后人工处理");
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
