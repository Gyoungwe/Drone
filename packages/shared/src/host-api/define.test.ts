import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { type ClientOf, channelOf, defineDomain, methodsWithAccess } from "./define";

const C = defineDomain("demo", {
	methods: { ping: { args: Type.Tuple([Type.String()]), result: Type.Number() } },
	events: { changed: Type.Boolean() },
});
type Client = ClientOf<typeof C>;
const typedClient: Client = { ping: async (x) => x.length, onChanged: (_cb) => () => {} };

describe("host-api definitions", () => {
	it("builds stable channels", () => {
		expect(channelOf(C, "ping")).toBe("demo:ping");
		expect(C.methods.ping.access).toBe("desktop");
		expect(channelOf("demo", "changed")).toBe("demo:changed");
	});
	it("derives callable clients", async () => {
		expect(await typedClient.ping("ok")).toBe(2);
	});
	it("selects methods by transport access for host adapters", () => {
		const domain = defineDomain("demo", {
			methods: {
				read: { args: Type.Tuple([]), result: Type.String(), access: "lan-read" },
				write: { args: Type.Tuple([]), result: Type.String(), access: "lan-control" },
				local: { args: Type.Tuple([]), result: Type.String() },
			},
		});
		expect(methodsWithAccess(domain, "lan-read")).toEqual(["read"]);
		expect(methodsWithAccess(domain, "lan-control")).toEqual(["write"]);
	});
});
