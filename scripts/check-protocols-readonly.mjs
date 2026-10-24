#!/usr/bin/env node
/**
 * Real, read-only Protocols.io acceptance. It deliberately performs one public
 * page GET and never sends a bearer token or a mutation request.
 */
import assert from "node:assert/strict";

const target =
	process.env.DRONE_PROTOCOLS_READONLY_URL ??
	"https://www.protocols.io/view/isothermal-titration-calorimetry-itc-g2u8byezx";
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 15_000);
try {
	const response = await fetch(target, {
		headers: { accept: "text/html", "user-agent": "Drone-readonly-acceptance/1.0" },
		signal: controller.signal,
	});
	const body = await response.text();
	assert.equal(response.ok, true, `Protocols.io public GET returned ${response.status}`);
	assert.match(body, /protocols\.io/i);
	const title = body.match(/<title[^>]*>([^<]+)/i)?.[1]?.trim() ?? "";
	assert.ok(title.length > 0, "Protocols.io public page did not expose a title");
	console.log(
		JSON.stringify(
			{
				kind: "protocols-io-readonly-acceptance",
				status: "PASS",
				method: "GET",
				url: target,
				statusCode: response.status,
				title,
				mutations: 0,
				credentials: "none",
			},
			null,
			2,
		),
	);
} finally {
	clearTimeout(timer);
}
