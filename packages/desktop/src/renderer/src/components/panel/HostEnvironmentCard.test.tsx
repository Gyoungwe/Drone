import type { HostEnvironment } from "@drone/shared";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../i18n", () => ({ useT: () => (key: string) => key }));
vi.stubGlobal("React", React);

import { HostEnvironmentView } from "./HostEnvironmentCard";

const env: HostEnvironment = {
	os: "macOS",
	kernel: "Darwin",
	arch: "arm64",
	hostname: "local-workstation",
	cpu: { model: "Apple Silicon", cores: 8, loadPercent: 14 },
	memory: { totalBytes: 16 * 1024 ** 3, freeBytes: 8 * 1024 ** 3 },
	disk: { path: "/", totalBytes: 512 * 1024 ** 3, freeBytes: 256 * 1024 ** 3 },
	tools: [],
	pythonPackages: 12,
	npmPackages: 4,
	probedAt: "2026-10-20T00:00:00.000Z",
};

describe("HostEnvironmentView", () => {
	it("shows the local host section and a healthy status", () => {
		const html = renderToStaticMarkup(
			createElement(HostEnvironmentView, { env, loading: false, onRefresh: () => undefined }),
		);

		expect(html).toContain('data-testid="local-host-section"');
		expect(html).toContain("panel.hostEnv.status.healthy");
		expect(html).toContain("local-workstation");
	});

	it("exposes a failure status and message after a local probe error", () => {
		const html = renderToStaticMarkup(
			createElement(HostEnvironmentView, {
				env: null,
				loading: false,
				error: "probe failed",
				onRefresh: () => undefined,
			}),
		);

		expect(html).toContain("panel.hostEnv.status.offline");
		expect(html).toContain("probe failed");
	});
});
