import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { HttpAuthChallenges, type HttpAuthSend, validHttpUsername } from "./http-auth";

const credential = { username: "fixture-user", password: "synthetic-http-auth-password-42" };
const request = { method: "PUT", url: new URL("https://example.test/files/a%20b?version=2#ignored") };
const digestChallenge = 'Digest realm="fixture", nonce="nonce-a", qop="auth"';

function unauthorized(challenge: string): Response {
	return new Response("Synthetic rejected response", {
		status: 401,
		headers: { "www-authenticate": challenge },
	});
}

function challengedSend(challenge = digestChallenge) {
	return vi
		.fn<HttpAuthSend>()
		.mockResolvedValueOnce(unauthorized(challenge))
		.mockResolvedValue(new Response());
}

function md5(value: string): string {
	return createHash("md5").update(value, "utf8").digest("hex");
}

it("sends no Authorization before negotiation and returns the original successful response", async () => {
	const response = new Response("Synthetic successful response");
	const send = vi.fn<HttpAuthSend>().mockResolvedValue(response);
	expect(await new HttpAuthChallenges().send("scope", request, credential, send)).toBe(response);
	expect(send.mock.calls).toEqual([[null]]);
	expect(response.bodyUsed).toBe(false);
});

it.each([
	{ algorithm: "MD5", qop: true, explicitAlgorithm: true },
	{ algorithm: "MD5-SESS", qop: true, explicitAlgorithm: true },
	{ algorithm: "MD5", qop: false, explicitAlgorithm: false },
	{ algorithm: "MD5-SESS", qop: false, explicitAlgorithm: true },
])("computes exact $algorithm Digest header parts with qop=$qop", async (testCase) => {
	const { algorithm, qop, explicitAlgorithm } = testCase;
	const challenge = [
		'Digest realm="fixture", nonce="nonce-a", opaque="opaque-a"',
		...(explicitAlgorithm ? [`algorithm=${algorithm.toLowerCase()}`] : []),
		...(qop ? ['qop="auth-int, auth"'] : []),
	].join(", ");
	const rejected = unauthorized(challenge);
	const send = vi.fn<HttpAuthSend>().mockResolvedValueOnce(rejected).mockResolvedValue(new Response());
	await new HttpAuthChallenges().send("scope", request, credential, send);
	const header = String(send.mock.calls[1]?.[0]);
	const cnonce = header.match(/cnonce="([a-f0-9]{32})"/)?.[1];
	if (qop || algorithm === "MD5-SESS") expect(cnonce).toMatch(/^[a-f0-9]{32}$/);
	// Derive the expected wire response independently, using only the observed random cnonce.
	const initialHa1 = md5(`${credential.username}:fixture:${credential.password}`);
	const ha1 = algorithm === "MD5-SESS" ? md5(`${initialHa1}:nonce-a:${cnonce}`) : initialHa1;
	const ha2 = md5("PUT:/files/a%20b?version=2");
	const expected = qop ? md5(`${ha1}:nonce-a:00000001:${cnonce}:auth:${ha2}`) : md5(`${ha1}:nonce-a:${ha2}`);
	expect(header).toBe(
		[
			'Digest username="fixture-user"',
			'realm="fixture"',
			'nonce="nonce-a"',
			'uri="/files/a%20b?version=2"',
			`response="${expected}"`,
			`algorithm=${algorithm}`,
			...(qop ? ["qop=auth", "nc=00000001"] : []),
			...(qop || algorithm === "MD5-SESS" ? [`cnonce="${cnonce}"`] : []),
			'opaque="opaque-a"',
		].join(", "),
	);
	expect(header).not.toContain(credential.password);
	expect(send.mock.calls[0]).toEqual([null]);
	expect(send).toHaveBeenCalledTimes(2);
	expect(rejected.bodyUsed).toBe(true);
});

it.each([`Basic realm="basic", ${digestChallenge}`, `${digestChallenge}, Basic realm="basic"`])(
	"prefers Digest when both schemes are offered (%#)",
	async (challenge) => {
		const send = challengedSend(challenge);
		await new HttpAuthChallenges().send("scope", request, credential, send);
		expect(send.mock.calls[1]?.[0]).toMatch(/^Digest /);
		expect(send).toHaveBeenCalledTimes(2);
	},
);

it("unescapes challenge values and quotes Digest username, realm, nonce and opaque", async () => {
	const send = challengedSend(String.raw`Digest realm="a,\"b\\c", nonce="n\"q", opaque="o\\p", qop="auth"`);
	await new HttpAuthChallenges().send("scope", request, { ...credential, username: 'u"\\name' }, send);
	const header = String(send.mock.calls[1]?.[0]);
	expect(header).toContain(String.raw`username="u\"\\name"`);
	expect(header).toContain(String.raw`realm="a,\"b\\c"`);
	expect(header).toContain(String.raw`nonce="n\"q"`);
	expect(header).toContain(String.raw`opaque="o\\p"`);
});

it("reuses stored Digest with an incremented nonce count and fresh 16-byte cnonce", async () => {
	const auth = new HttpAuthChallenges();
	const send = challengedSend();
	await auth.send("scope", request, credential, send);
	await auth.send("scope", request, credential, send);
	expect(send).toHaveBeenCalledTimes(3);
	expect(send.mock.calls[1]?.[0]).toContain("nc=00000001");
	expect(send.mock.calls[2]?.[0]).toContain("nc=00000002");
	const cnonces = send.mock.calls.slice(1).map(([header]) => header?.match(/cnonce="([a-f0-9]{32})"/)?.[1]);
	expect(cnonces[0]).toMatch(/^[a-f0-9]{32}$/);
	expect(cnonces[1]).toMatch(/^[a-f0-9]{32}$/);
	expect(cnonces[0]).not.toBe(cnonces[1]);
});

it("refreshes a rejected stored challenge once and tracks counts per nonce", async () => {
	const auth = new HttpAuthChallenges();
	const send = challengedSend();
	await auth.send("scope", request, credential, send);
	send.mockResolvedValueOnce(unauthorized(digestChallenge.replace("nonce-a", "nonce-b")));
	await auth.send("scope", request, credential, send);
	send.mockResolvedValueOnce(unauthorized(`${digestChallenge}, stale=true`));
	await auth.send("scope", request, credential, send);
	expect(send).toHaveBeenCalledTimes(6);
	const headers = send.mock.calls.slice(1).map(([header]) => header);
	expect(headers[0]).toContain('nonce="nonce-a"');
	expect(headers[0]).toContain("nc=00000001");
	expect(headers[1]).toContain("nc=00000002");
	expect(headers[2]).toContain('nonce="nonce-b"');
	expect(headers[2]).toContain("nc=00000001");
	expect(headers[3]).toContain("nc=00000002");
	expect(headers[4]).toContain('nonce="nonce-a"');
	expect(headers[4]).toContain("nc=00000003");
});

it("sends Basic only after a Basic challenge and reuses the negotiated scheme", async () => {
	const auth = new HttpAuthChallenges();
	const send = challengedSend('bAsIc realm="fixture"');
	await auth.send("scope", request, credential, send);
	await auth.send("scope", request, credential, send);
	const basic = `Basic ${Buffer.from(`${credential.username}:${credential.password}`).toString("base64")}`;
	expect(send.mock.calls).toEqual([[null], [basic], [basic]]);
});

it("does not repeat Basic after a second 401 or a rejected stored Basic attempt", async () => {
	const auth = new HttpAuthChallenges();
	const challenge = 'Basic realm="fixture"';
	const first = unauthorized(challenge);
	const second = unauthorized(challenge);
	const send = vi.fn<HttpAuthSend>().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
	expect(await auth.send("scope", request, credential, send)).toBe(second);
	expect(send).toHaveBeenCalledTimes(2);
	expect(first.bodyUsed).toBe(true);
	expect(second.bodyUsed).toBe(true);
	const third = unauthorized(challenge);
	send.mockResolvedValueOnce(third);
	expect(await auth.send("scope", request, credential, send)).toBe(third);
	expect(send).toHaveBeenCalledTimes(3);
	expect(third.bodyUsed).toBe(true);
});

it("upgrades negotiated Basic to Digest when challenged", async () => {
	const auth = new HttpAuthChallenges();
	const send = challengedSend('Basic realm="fixture"');
	await auth.send("scope", request, credential, send);
	send.mockResolvedValueOnce(unauthorized(digestChallenge));
	await auth.send("scope", request, credential, send);
	expect(send).toHaveBeenCalledTimes(4);
	expect(send.mock.calls[2]?.[0]).toMatch(/^Basic /);
	expect(send.mock.calls[3]?.[0]).toMatch(/^Digest /);
});

it.each([
	'Digest realm="fixture", nonce="n", algorithm=SHA-256, qop="auth"',
	'Digest realm="fixture", nonce="n", qop="auth-int"',
	'Digest realm="fixture", nonce="n", qop=""',
	'Digest realm="fixture", qop="auth"',
	'Digest nonce="n", qop="auth"',
	'Bearer realm="fixture"',
	"",
])("returns unsupported or incomplete challenges unchanged with one send (%#)", async (challenge) => {
	const response = unauthorized(challenge);
	const send = vi.fn<HttpAuthSend>().mockResolvedValue(response);
	expect(await new HttpAuthChallenges().send("scope", request, credential, send)).toBe(response);
	expect(send.mock.calls).toEqual([[null]]);
	expect(response.bodyUsed).toBe(true);
});

it("falls back to offered Basic when Digest is unsupported", async () => {
	const send = challengedSend('Digest realm="fixture", nonce="n", algorithm=SHA-256, Basic realm="fixture"');
	await new HttpAuthChallenges().send("scope", request, credential, send);
	expect(send.mock.calls[1]?.[0]).toMatch(/^Basic /);
	expect(send).toHaveBeenCalledTimes(2);
});

it.each([
	'Bearer realm="a Basic fixture"',
	'Digest realm="a Basic fixture", nonce="n", algorithm=SHA-256',
	'Digest realm="fixture", nonce="n", qop="auth',
])("does not treat quoted scheme names or malformed Digest as an offer (%#)", async (challenge) => {
	const response = unauthorized(challenge);
	const send = vi.fn<HttpAuthSend>().mockResolvedValue(response);
	expect(await new HttpAuthChallenges().send("scope", request, credential, send)).toBe(response);
	expect(send.mock.calls).toEqual([[null]]);
});

it("selects a supported Digest challenge among multiple offers", async () => {
	const send = challengedSend(`Digest realm="unsupported", nonce="n", algorithm=SHA-256, ${digestChallenge}`);
	await new HttpAuthChallenges().send("scope", request, credential, send);
	expect(send.mock.calls[1]?.[0]).toContain('Digest username="fixture-user", realm="fixture"');
	expect(send.mock.calls[1]?.[0]).toContain("algorithm=MD5");
	expect(send).toHaveBeenCalledTimes(2);
});

it("does not use another scheme's parameters to complete an invalid Digest challenge", async () => {
	const send = challengedSend('Digest realm="fixture", Basic realm="basic", nonce="belongs-to-basic"');
	await new HttpAuthChallenges().send("scope", request, credential, send);
	expect(send.mock.calls[1]?.[0]).toMatch(/^Basic /);
});

it("never sends more than twice even when the second 401 offers a new Digest challenge", async () => {
	const second = unauthorized(digestChallenge.replace("nonce-a", "nonce-b"));
	const send = vi
		.fn<HttpAuthSend>()
		.mockResolvedValueOnce(unauthorized(digestChallenge))
		.mockResolvedValue(second);
	expect(await new HttpAuthChallenges().send("scope", request, credential, send)).toBe(second);
	expect(send).toHaveBeenCalledTimes(2);
	expect(second.bodyUsed).toBe(true);
});

it("keeps negotiated schemes and nonce counts separate across scopes", async () => {
	const auth = new HttpAuthChallenges();
	const first = challengedSend();
	const second = challengedSend();
	const third = challengedSend('Basic realm="fixture"');
	await auth.send("source-a:slot", request, credential, first);
	await auth.send("source-b:slot", request, credential, second);
	await auth.send("source-c:slot", request, credential, third);
	await auth.send("source-a:slot", request, credential, first);
	expect(second.mock.calls[0]).toEqual([null]);
	expect(second.mock.calls[1]?.[0]).toContain("nc=00000001");
	expect(third.mock.calls[0]).toEqual([null]);
	expect(third.mock.calls[1]?.[0]).toMatch(/^Basic /);
	expect(first.mock.calls[2]?.[0]).toContain("nc=00000002");
});

it("invalidates all matching prefixes including schemes and nonce counts, preserving other scopes", async () => {
	const auth = new HttpAuthChallenges();
	const first = challengedSend();
	const second = challengedSend('Basic realm="fixture"');
	const other = challengedSend();
	await auth.send("slot:a", request, credential, first);
	await auth.send("slot:b", request, credential, second);
	await auth.send("other:a", request, credential, other);
	auth.invalidate("slot:");
	first.mockResolvedValueOnce(unauthorized(digestChallenge));
	await auth.send("slot:a", request, credential, first);
	await auth.send("slot:b", request, credential, second);
	await auth.send("other:a", request, credential, other);
	expect(first.mock.calls[2]).toEqual([null]);
	expect(first.mock.calls[3]?.[0]).toContain("nc=00000001");
	expect(second.mock.calls[2]).toEqual([null]);
	expect(other.mock.calls[2]?.[0]).toContain("nc=00000002");
});

it.each(["fixture-user", "a".repeat(256), 'u"\\name', "fixture-\u00e9"])(
	"accepts a valid HTTP username (%#)",
	(username) => expect(validHttpUsername(username)).toBe(true),
);

it.each([null, undefined, 123, {}])("rejects non-string HTTP usernames (%#)", (username) => {
	expect(validHttpUsername(username)).toBe(false);
});

it.each(["", "a".repeat(257), "a:b", "a\r", "a\n", "a\t", "a\0", "a\u007f", "a\u0085"])(
	"rejects invalid usernames with a fixed error and never includes the synthetic password (%#)",
	async (username) => {
		expect(validHttpUsername(username)).toBe(false);
		const send = vi.fn<HttpAuthSend>();
		const error = await new HttpAuthChallenges()
			.send("scope", request, { ...credential, username }, send)
			.catch((failure: unknown) => failure);
		expect(error).toBeInstanceOf(Error);
		expect(error).toHaveProperty("message", "Invalid HTTP authentication username");
		expect(error).not.toHaveProperty("message", expect.stringContaining(credential.password));
		expect(send).not.toHaveBeenCalled();
	},
);

it.each([false, true])("propagates network errors unchanged after challenge=%s", async (afterChallenge) => {
	const failure = new Error("Synthetic network failure");
	const send = vi.fn<HttpAuthSend>();
	if (afterChallenge) send.mockResolvedValueOnce(unauthorized(digestChallenge));
	send.mockRejectedValueOnce(failure);
	await expect(new HttpAuthChallenges().send("scope", request, credential, send)).rejects.toBe(failure);
	expect(failure.message).not.toContain(credential.password);
	expect(send).toHaveBeenCalledTimes(afterChallenge ? 2 : 1);
});
