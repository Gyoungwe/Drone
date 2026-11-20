import { expect, it } from "vitest";
import { ComputeTransportError } from "./compute-operation-lifetime";
import { deployRunnerScript } from "./runner-deployment";

const source = Buffer.from("bundled runner\n");
const tampered = Buffer.from("altered runner\n");
const remoteRoot = "/workspace/.drone";
const remotePath = `${remoteRoot}/runner/d0f24dd6e1edb8fd9fc213907205e735621eeb4f7f74dcd83fd65030f6a23c45/runner.py`;
const maxUploadBytes = 1024;
const downloadCall = ["download", { source: remotePath, maxBytes: source.byteLength + 1 }];
const uploadCall = ["upload", { source, destination: remotePath, maxBytes: maxUploadBytes }];

function fakeTransport(initialCopy: Uint8Array | Error, readback = source, uploadError?: Error) {
	const calls: Array<["download" | "upload", object]> = [];
	let uploaded = false;
	const transport: Parameters<typeof deployRunnerScript>[0] = {
		async download(request) {
			calls.push(["download", request]);
			if (uploaded) return readback;
			if (initialCopy instanceof Error) throw initialCopy;
			return initialCopy;
		},
		async upload(request) {
			calls.push(["upload", request]);
			if (uploadError) throw uploadError;
			uploaded = true;
		},
	};
	return { transport, calls };
}

it("reuses the content-addressed runner when the remote copy matches", async () => {
	const { transport, calls } = fakeTransport(Buffer.from(source));

	await expect(deployRunnerScript(transport, source, remoteRoot, maxUploadBytes)).resolves.toBe(remotePath);
	expect(calls).toEqual([downloadCall]);
});

it("uploads a missing remote runner and verifies it by reading it back", async () => {
	const { transport, calls } = fakeTransport(new Error("Runner is missing"));

	await expect(deployRunnerScript(transport, source, remoteRoot, maxUploadBytes)).resolves.toBe(remotePath);
	expect(calls).toEqual([downloadCall, uploadCall, downloadCall]);
});

it("replaces a tampered remote runner and verifies the replacement", async () => {
	const { transport, calls } = fakeTransport(tampered);

	await expect(deployRunnerScript(transport, source, remoteRoot, maxUploadBytes)).resolves.toBe(remotePath);
	expect(calls).toEqual([downloadCall, uploadCall, downloadCall]);
});

it("rejects when the remote runner still differs after upload", async () => {
	const { transport, calls } = fakeTransport(tampered, tampered);

	const deployment = deployRunnerScript(transport, source, remoteRoot, maxUploadBytes);
	await expect(deployment).rejects.toBeInstanceOf(ComputeTransportError);
	await expect(deployment).rejects.toMatchObject({
		code: "runner-checksum",
		message: "Remote runner checksum verification failed",
	});
	expect(calls).toEqual([downloadCall, uploadCall, downloadCall]);
});

it("propagates the original upload error without reading back", async () => {
	const uploadError = new Error("Upload failed");
	const { transport, calls } = fakeTransport(tampered, source, uploadError);

	await expect(deployRunnerScript(transport, source, remoteRoot, maxUploadBytes)).rejects.toBe(uploadError);
	expect(calls).toEqual([downloadCall, uploadCall]);
});
