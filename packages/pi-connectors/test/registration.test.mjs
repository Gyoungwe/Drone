import assert from "node:assert/strict";
import test from "node:test";

const { ConnectorRegistry, createConnectorReceipt, planConnectorOperation, registerPiConnectors } =
	await import("../dist/index.mjs");

test("registerPiConnectors exposes read-only declaration tools", async () => {
	const tools = [];
	const pi = {
		registerTool(tool) {
			tools.push(tool);
		},
	};
	const registration = registerPiConnectors(pi);
	assert.deepEqual(registration.tools, ["connector_list", "connector_get"]);
	assert.deepEqual(
		tools.map((tool) => tool.name),
		["connector_list", "connector_get"],
	);
	const listed = await tools[0].execute();
	assert.deepEqual(
		listed.details.connectors.map((descriptor) => descriptor.id),
		["browser", "generic-mcp", "institutional", "search", "webdav", "zotero"],
	);
	assert.equal(
		listed.details.connectors.every((descriptor) => descriptor.permissions.readOnly),
		true,
	);
});

test("registry plans reads and blocks undeclared writes", () => {
	const registry = new ConnectorRegistry();
	const zotero = registry.require("zotero");
	assert.equal(planConnectorOperation(zotero, "read").status, "allowed");
	assert.equal(planConnectorOperation(zotero, "write").status, "unsupported");
	const browser = registry.require("browser");
	assert.equal(planConnectorOperation(browser, "browser-handoff").status, "requires-authorization");
	assert.equal(planConnectorOperation(browser, "browser-handoff", "auth:fixture").status, "allowed");
});

test("receipts preserve readback phases without performing I/O", () => {
	const attempt = createConnectorReceipt({
		receiptId: "receipt:fixture-attempt",
		connectorId: "webdav",
		host: "drone-desktop",
		operation: "write",
		phase: "attempt",
		status: "succeeded",
		observedAt: "2026-10-18T00:00:00.000Z",
		readOnly: false,
		externalSideEffects: ["remote-write"],
		authorizationRef: "auth:fixture",
	});
	const readback = createConnectorReceipt({
		receiptId: "receipt:fixture-readback",
		connectorId: "webdav",
		host: "drone-desktop",
		operation: "read",
		phase: "readback",
		status: "succeeded",
		observedAt: "2026-10-18T00:00:01.000Z",
		readOnly: true,
		externalSideEffects: [],
		parentReceiptId: attempt.receiptId,
		contentHash: "a".repeat(64),
	});
	assert.equal(readback.parentReceiptId, attempt.receiptId);
	assert.equal(attempt.externalSideEffects.includes("remote-write"), true);
});
