import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formalKnowledgeVault } from "./formal-knowledge";

const userData = join("/u", "Drone-dev");
const bindingPath = join("/u", "Drone", "knowledge", "binding.json");

describe("formalKnowledgeVault", () => {
	it("reads the formal binding for an isolated development build", async () => {
		const vault = await formalKnowledgeVault({
			isPackaged: false,
			userData,
			read: async (path) => {
				expect(path).toBe(bindingPath);
				return '﻿{"vault":"/v/Research"}';
			},
			isDirectory: async (path) => path === "/v/Research",
		});
		expect(vault).toBe("/v/Research");
	});

	it("returns null for packaged builds and non-isolated user data", async () => {
		const read = async () => '{"vault":"/v"}';
		const isDirectory = async () => true;
		expect(await formalKnowledgeVault({ isPackaged: true, userData, read, isDirectory })).toBeNull();
		expect(
			await formalKnowledgeVault({ isPackaged: false, userData: "/u/Drone", read, isDirectory }),
		).toBeNull();
	});

	it("returns null when the binding is missing, invalid, or the vault is gone", async () => {
		const missing = async () => {
			throw new Error("ENOENT");
		};
		expect(await formalKnowledgeVault({ isPackaged: false, userData, read: missing })).toBeNull();
		expect(
			await formalKnowledgeVault({
				isPackaged: false,
				userData,
				read: async () => "{",
				isDirectory: async () => true,
			}),
		).toBeNull();
		expect(
			await formalKnowledgeVault({
				isPackaged: false,
				userData,
				read: async () => '{"vault":"/gone"}',
				isDirectory: async () => false,
			}),
		).toBeNull();
	});
});
