import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { ARTIFACT_SURFACES, isArtifactContributionProps } from "../dist/ui-artifact.js";

const idKeys = ["artifactId", "analysisId", "capabilityId", "sessionId", "workspaceId"];
const displayProps = (surface) => ({
	surface,
	artifactId: "artifact-1",
	analysisId: "analysis-1",
	capabilityId: "capability-1",
	sessionId: "session-1",
	workspaceId: "workspace-1",
	renderDefault: () => assert.fail("validation must not render the host component"),
});

test("artifact surfaces preserve the public vocabulary", () => {
	assert.deepEqual(ARTIFACT_SURFACES, ["evidence.overview", "evidence.pane", "artifacts.card"]);
});

for (const surface of ARTIFACT_SURFACES) {
	test(`accepts closed display props for ${surface} with string or null IDs`, () => {
		const props = Object.freeze(displayProps(surface));
		assert.equal(isArtifactContributionProps(props), true);
		assert.equal(
			isArtifactContributionProps({ ...props, ...Object.fromEntries(idKeys.map((key) => [key, null])) }),
			true,
		);
	});
}

test("rejects extra authority fields, including non-enumerable and symbol keys", () => {
	for (const key of ["runtime", "receiptRef", "providerId"]) {
		const props = displayProps("artifacts.card");
		assert.equal(isArtifactContributionProps({ ...props, [key]: "host-owned" }), false, key);
		assert.equal(
			isArtifactContributionProps(Object.defineProperty(props, key, { value: "host-owned" })),
			false,
			key,
		);
	}
	assert.equal(
		isArtifactContributionProps({ ...displayProps("artifacts.card"), [Symbol("runtime")]: {} }),
		false,
	);
});

test("rejects unknown surfaces and non-function default renderers", () => {
	const props = displayProps("evidence.pane");
	for (const surface of ["evidence", "panel.artifacts.card", "", null, 1])
		assert.equal(isArtifactContributionProps({ ...props, surface }), false);
	for (const renderDefault of [undefined, null, "render", {}, 1])
		assert.equal(isArtifactContributionProps({ ...props, renderDefault }), false);
});

test("requires every display field and limits IDs to string or null", () => {
	const props = displayProps("evidence.overview");
	for (const key of Object.keys(props)) {
		const incomplete = { ...props };
		delete incomplete[key];
		assert.equal(isArtifactContributionProps(incomplete), false, key);
	}
	for (const key of idKeys)
		for (const invalid of [undefined, 1, false, {}, []])
			assert.equal(isArtifactContributionProps({ ...props, [key]: invalid }), false, key);
	for (const invalid of [undefined, null, false, 1, "props", []])
		assert.equal(isArtifactContributionProps(invalid), false);
});

test("the artifact contribution region is present in shared and renderer lists", async () => {
	for (const [path, exportName] of [
		["../../shared/src/ui-plugins.ts", "KNOWN_UI_REGIONS"],
		["../../desktop/src/renderer/src/plugins/slots.ts", "UI_REGIONS"],
	]) {
		const source = readFileSync(new URL(path, import.meta.url), "utf8");
		const { outputText } = ts.transpileModule(source, {
			compilerOptions: { module: ts.ModuleKind.ESNext },
		});
		const regions = await import(`data:text/javascript,${encodeURIComponent(outputText)}`);
		assert.ok(Object.values(regions[exportName]).includes("panel.artifact.contribution"), path);
	}
});
