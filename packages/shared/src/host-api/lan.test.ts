import { Check } from "typebox/value";
import { describe, expect, it } from "vitest";
import { channelOf } from "./define";
import { LanContract } from "./lan";

const status = {
	enabled: true,
	port: 4318,
	urls: ["http://192.168.1.2:4318/?t=token"],
	qrDataUrl: "data:image/png;base64,abc",
	clients: 1,
	remoteControl: false,
};

describe("LanContract", () => {
	it("keeps stable channels and transport access labels", () => {
		expect(channelOf(LanContract, "getStatus")).toBe("lan:getStatus");
		expect(channelOf(LanContract, "setEnabled")).toBe("lan:setEnabled");
		expect(channelOf(LanContract, "setRemoteControl")).toBe("lan:setRemoteControl");
		expect(LanContract.methods.getStatus.access).toBe("lan-read");
		expect(LanContract.methods.setEnabled.access).toBe("desktop");
		expect(LanContract.methods.setRemoteControl.access).toBe("desktop");
	});

	it("validates the status projection and method arguments", () => {
		expect(Check(LanContract.methods.getStatus.args, [])).toBe(true);
		expect(Check(LanContract.methods.getStatus.args, ["unexpected"])).toBe(false);
		expect(Check(LanContract.methods.getStatus.result, status)).toBe(true);
		expect(Check(LanContract.methods.getStatus.result, { ...status, clients: -1 })).toBe(false);
		expect(Check(LanContract.methods.setEnabled.args, [false])).toBe(true);
		expect(Check(LanContract.methods.setEnabled.args, ["false"])).toBe(false);
	});
});
