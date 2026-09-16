import { lstat, mkdir, readdir, rename, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createLogger } from "@drone/backend";

const log = createLogger("legacy-migration");

const LEGACY_DIR = join(homedir(), ".percho");
const CURRENT_DIR = join(homedir(), ".drone");
/** 迁移完成标记：存在即不再重试，避免每次启动都 stat 老目录 */
const MARKER = join(CURRENT_DIR, ".migrated-from-percho");

/**
 * 一次性把 ~/.percho 的用户数据接到 ~/.drone（percho → Drone 更名，v0.10.0）。
 *
 * 只搬 daily 工作区：它是用户真实产出（日常会话的固定 cwd）。
 * ui-plugins 不搬——那是指向 userData 的 symlink/junction，新 appId 下
 * userData 本就是新目录，重建即可，搬过去只会指向旧应用的数据。
 *
 * 全程非破坏：老目录保留原样（rename 仅在目标不存在时执行，否则跳过），
 * 任何失败都只告警，绝不阻断启动。
 */
export async function migrateLegacyUserDir(): Promise<void> {
	try {
		if (await lstat(MARKER).catch(() => null)) return;
		const legacy = await lstat(LEGACY_DIR).catch(() => null);
		if (!legacy?.isDirectory()) return;

		await mkdir(CURRENT_DIR, { recursive: true });

		const legacyDaily = join(LEGACY_DIR, "daily");
		const currentDaily = join(CURRENT_DIR, "daily");
		const hasLegacyDaily = (await lstat(legacyDaily).catch(() => null))?.isDirectory();
		const hasCurrentDaily = await lstat(currentDaily).catch(() => null);

		if (hasLegacyDaily && !hasCurrentDaily) {
			const entries = await readdir(legacyDaily).catch(() => []);
			if (entries.length > 0) {
				// 同盘 rename 是原子的；跨盘/占用时回退为「留在原地 + 建链接」，不做递归复制
				try {
					await rename(legacyDaily, currentDaily);
					log.info(`daily 工作区已迁移：${legacyDaily} → ${currentDaily}`);
				} catch (err) {
					try {
						await symlink(legacyDaily, currentDaily, process.platform === "win32" ? "junction" : undefined);
						log.warn(`daily 无法移动，已建链接指向旧目录（${legacyDaily}）`, err);
					} catch (linkErr) {
						log.error("daily 迁移与链接均失败，旧数据保留在原位", linkErr);
						return;
					}
				}
			}
		}
		await writeFile(MARKER, new Date().toISOString(), "utf8");
	} catch (err) {
		// 迁移是尽力而为：失败不影响应用启动，用户数据仍在 ~/.percho
		log.error("旧用户目录迁移失败（原数据未改动）", err);
	}
}
