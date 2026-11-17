// @vitest-environment jsdom
import type { PluginCredentialEntry } from "@drone/shared";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useI18nStore } from "../../i18n";
import { PluginCredentialsSection } from "./PluginCredentialsSection";
import { WebDavEndpointStatus } from "./WebDavEndpointStatus";

const pi = vi.hoisted(() => ({ listPluginCredentials: vi.fn() }));
vi.mock("../../api", () => ({ getPi: () => pi }));
vi.stubGlobal("React", React);
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const copy = {
	zh: {
		label: "生效地址",
		default: "使用默认地址。",
		env: "地址来自环境变量 DRONE_WEBDAV_ENDPOINT。",
		invalid:
			"DRONE_WEBDAV_ENDPOINT 无效；云端操作已停用。请设置带明确端口、无凭据和路径参数的 HTTP(S) 根地址，然后重启 Drone。",
		warning: "当前地址使用未加密的 HTTP；请仅在可信网络中使用。",
	},
	en: {
		label: "Effective endpoint",
		default: "Using the default endpoint.",
		env: "Endpoint from environment variable DRONE_WEBDAV_ENDPOINT.",
		invalid:
			"DRONE_WEBDAV_ENDPOINT is invalid; cloud operations are disabled. Set an HTTP(S) root URL with an explicit port and no credentials or path parameters, then restart Drone.",
		warning: "The current endpoint uses unencrypted HTTP; use it only on a trusted network.",
	},
};
const languages = ["zh", "en"] as const;
const defaultEndpoint = {
	state: "ready",
	url: "http://10.126.126.1:8080",
	source: "default",
} as const;

it.each(languages)("renders the default endpoint row in %s", (language) => {
	useI18nStore.setState({ language });
	render(<WebDavEndpointStatus endpoint={defaultEndpoint} />);
	expect(screen.getByText(copy[language].label)).toBeTruthy();
	expect(screen.getByText(defaultEndpoint.url)).toBeTruthy();
	expect(screen.getByText(copy[language].default)).toBeTruthy();
});

it.each(languages)("renders the env endpoint row in %s", (language) => {
	useI18nStore.setState({ language });
	const url = "https://dav.example:8443";
	render(<WebDavEndpointStatus endpoint={{ state: "ready", url, source: "env" }} />);
	expect(screen.getByText(copy[language].label)).toBeTruthy();
	expect(screen.getByText(url)).toBeTruthy();
	expect(screen.getByText(copy[language].env)).toBeTruthy();
	expect(screen.queryByText(copy[language].default)).toBeNull();
});

it.each(languages)("renders the fixed invalid message with no URL in %s", (language) => {
	useI18nStore.setState({ language });
	const { container } = render(
		<WebDavEndpointStatus endpoint={{ state: "invalid", reason: "invalid_endpoint" }} />,
	);
	expect(screen.getByText(copy[language].invalid)).toBeTruthy();
	expect(container.textContent).not.toMatch(/https?:\/\//);
	expect(screen.queryByText(copy[language].default)).toBeNull();
	expect(screen.queryByText(copy[language].env)).toBeNull();
	expect(screen.queryByText(copy[language].warning)).toBeNull();
});

it.each(languages)("shows the HTTP warning for an HTTP endpoint in %s", (language) => {
	useI18nStore.setState({ language });
	render(<WebDavEndpointStatus endpoint={defaultEndpoint} />);
	expect(screen.getByText(copy[language].warning)).toBeTruthy();
});

it.each(languages)("omits the HTTP warning for HTTPS in %s", (language) => {
	useI18nStore.setState({ language });
	render(
		<WebDavEndpointStatus endpoint={{ state: "ready", url: "https://dav.example:8443", source: "env" }} />,
	);
	expect(screen.queryByText(copy[language].warning)).toBeNull();
});

it.each(languages)("shows a valid endpoint inside the card without a password in %s", async (language) => {
	useI18nStore.setState({ language });
	const entry: PluginCredentialEntry = {
		pluginId: "@gyoungwe/pi-knowledge",
		slot: "webdav",
		label: { zh: "WebDAV password", en: "WebDAV password" },
		hosts: ["10.126.126.1:8080", "dav.example:8443"],
		fields: [],
		configured: false,
		source: null,
		savedConfigured: false,
		values: {},
		endpoint: { state: "ready", url: "https://dav.example:8443", source: "env" },
	};
	pi.listPluginCredentials.mockResolvedValueOnce([entry]);
	render(<PluginCredentialsSection />);
	const origin = await screen.findByText("https://dav.example:8443");
	expect(origin.closest(".rounded-xl")?.textContent).toContain("WebDAV password");
	expect(screen.getByText(copy[language].env)).toBeTruthy();
	expect(screen.getByText(/10\.126\.126\.1:8080, dav\.example:8443/)).toBeTruthy();
});

it.each(languages)("renders the full selectable wrapping bracketed IPv6 origin in %s", (language) => {
	useI18nStore.setState({ language });
	const url = "https://[2001:db8:1234:5678:abcd:ef01:2345:6789]:65535";
	render(<WebDavEndpointStatus endpoint={{ state: "ready", url, source: "env" }} />);
	const origin = screen.getByText(url);
	expect(origin.textContent).toBe(url);
	expect(origin.classList.contains("select-text")).toBe(true);
	expect(origin.classList.contains("break-all")).toBe(true);
});

it.each(languages)("renders nothing when endpoint is absent in %s", (language) => {
	useI18nStore.setState({ language });
	const { container } = render(<WebDavEndpointStatus />);
	expect(container.innerHTML).toBe("");
});
