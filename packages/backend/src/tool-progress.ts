import { Type } from "typebox";

/** Official SDK text/image progress accepted at the child-process boundary. */
export const toolProgressSchema = Type.Object({
	content: Type.Array(
		Type.Union([
			Type.Object({ type: Type.Literal("text"), text: Type.String() }),
			Type.Object({ type: Type.Literal("image"), data: Type.String(), mimeType: Type.String() }),
		]),
	),
	details: Type.Optional(Type.Unknown()),
});
