import { lstat, mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

/** Writer used by KernelSession.export; every target is checked against projectRoot/runs. */
export class ProjectRunFileWriter {
	constructor(private readonly projectRoot: string) {}
	private target(path: string): string {
		if (isAbsolute(path) || path.includes("\u0000")) throw new Error("export path must be relative");
		const target = resolve(this.projectRoot, path);
		const rel = relative(resolve(this.projectRoot), target).replaceAll("\\", "/");
		if (!rel.startsWith("runs/") || rel.includes("../"))
			throw new Error("exports are restricted to project runs");
		return target;
	}
	private async rejectSymlink(target: string): Promise<void> {
		const root = resolve(this.projectRoot);
		const rel = relative(root, target).replaceAll("\\", "/");
		const parts = rel.split("/");
		let current = root;
		for (const part of parts) {
			current = join(current, part);
			try {
				if ((await lstat(current)).isSymbolicLink()) throw new Error("export path contains a symlink");
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
		}
	}
	async prepareDirectory(path: string): Promise<void> {
		const target = this.target(`${path}/.directory`);
		await this.rejectSymlink(target);
		await mkdir(dirname(target), { recursive: true });
	}
	async write(path: string, content: string): Promise<void> {
		const target = this.target(path);
		await this.rejectSymlink(target);
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, content, { encoding: "utf8", flag: "wx" }).catch(async (error: unknown) => {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			await writeFile(target, content, { encoding: "utf8" });
		});
	}
}
