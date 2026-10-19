import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readSshConfigHosts } from "./ssh-config";

describe("readSshConfigHosts", () => {
	it("returns selectable aliases without reading identity file contents", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-ssh-config-"));
		await mkdir(join(root, ".ssh"));
		await writeFile(
			join(root, ".ssh", "config"),
			[
				"Host *",
				"  IdentityFile ~/.ssh/id_ed25519",
				"Host gaoxuze bee",
				"  HostName 10.126.126.1",
				"  Port 8080",
				"  User gaoyangwei",
				"  IdentityFile ~/.ssh/id_ed25519",
				"  ProxyJump bastion",
				"Host wildcard-*",
				"  HostName ignored.example",
			].join("\n"),
		);

		expect(await readSshConfigHosts(root)).toEqual([
			{
				alias: "bee",
				hostname: "10.126.126.1",
				port: 8080,
				user: "gaoyangwei",
				identityFiles: ["~/.ssh/id_ed25519"],
				proxyJump: "bastion",
				source: "ssh-config",
			},
			{
				alias: "gaoxuze",
				hostname: "10.126.126.1",
				port: 8080,
				user: "gaoyangwei",
				identityFiles: ["~/.ssh/id_ed25519"],
				proxyJump: "bastion",
				source: "ssh-config",
			},
		]);
	});

	it("treats a missing config as an empty discovery result", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-ssh-empty-"));
		expect(await readSshConfigHosts(root)).toEqual([]);
	});
});
