import { describe, expect, it } from "vitest";
import { NativeMessageCourier } from "./native-message-courier";

describe("actual native message associations", () => {
	it("keeps actual returned and in-place SDK objects while rejecting JSON copies and altered content", () => {
		const courier = new NativeMessageCourier();
		const original = { content: "before the actual SDK replacement" };
		const returned = { message: { content: "checked", proof: { id: "visible-real-id" } } };
		courier.remember(returned, { message: "private-reference" }, original);
		expect(courier.encode(returned)).toEqual({ message: "private-reference" });
		expect(courier.encode({ message: original })).toEqual({});
		Object.assign(original, returned.message);
		expect(courier.encode({ message: original })).toEqual({ message: "private-reference" });
		expect(courier.encode(structuredClone(returned))).toEqual({});
		returned.message.content = "copied proof but different answer";
		expect(courier.encode(returned)).toEqual({});
	});

	it("never shares references between attachments or authenticates an object from its JSON fields", () => {
		const one = new NativeMessageCourier(),
			two = new NativeMessageCourier();
		const result = { messages: [{ proof: "same actual proof id" }] };
		one.remember(result, { messages: ["1"] });
		expect(one.encode(result)).toEqual({ messages: ["1"] });
		expect(two.encode(result)).toEqual({ messages: [null] });
		expect(one.encode({ message: { ...result.messages[0], reference: "1" } })).toEqual({});
	});
});

it("transports only actual historical aliases and never infers identity from copied body or visible metadata", () => {
	const courier = new NativeMessageCourier();
	const historical = { role: "assistant", content: [{ type: "text", text: "saved" }], timestamp: 1 };
	const copy = structuredClone(historical);
	expect(courier.encode({ messages: [historical], persisted: [historical] })).toEqual({ messages: [null] });
	expect(courier.encodeSnapshot([historical, copy], [historical])).toEqual({
		messages: [null, null],
		historicalAliases: [0, null],
	});
	expect(courier.encodeSnapshot([copy], [structuredClone(copy)])).toEqual({
		messages: [null],
		historicalAliases: [null],
	});
});
