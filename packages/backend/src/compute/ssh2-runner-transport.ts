import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
	HostProfile,
	RunnerCommand,
	ShellChannel,
	TransportExecRequest,
	TransportExecResult,
} from "@drone/compute";
import {
	type Channel,
	Client,
	type ClientChannel,
	type ConnectConfig,
	type Prompt,
	type SFTPWrapper,
} from "ssh2";
import { ComputeTransportError } from "./compute-operation-lifetime";
import {
	type CollectingTransport,
	captureOutput,
	DEFAULT_MAX_RESPONSE_BYTES,
	DEFAULT_MAX_UPLOAD_BYTES,
	DEFAULT_TIMEOUT_MS,
	type DefaultComputeExecutorOptions,
	readUpload,
	safeRemoteAbsolutePath,
	shellQuote,
	toBuffer,
	withTimeout,
	writable,
} from "./runner-helpers";
import { HostKeyPolicy, readSshConfig, resolveIdentityFile } from "./ssh-host-config";

async function* emptyBytes(): AsyncIterable<Uint8Array> {
	// Keeps terminal consumers uniform when an SSH shell has no stderr stream.
}

export class Ssh2RunnerTransport implements CollectingTransport {
	private clients: Client[] = [];
	private connectionPromise?: Promise<Client>;
	private disposed = false;
	private readonly policy: HostKeyPolicy;

	constructor(
		private readonly host: HostProfile,
		private readonly options: DefaultComputeExecutorOptions,
		agentDir: string,
		readonly runnerPath: string,
		private readonly runnerRoot: string,
	) {
		this.policy = new HostKeyPolicy(options, agentDir);
	}

	private async effective(profile: HostProfile) {
		const config = await readSshConfig(this.options.userSshConfigPath, profile.alias);
		const merged = {
			...profile,
			...(profile.host === profile.alias && config.hostName ? { host: config.hostName } : {}),
			...(profile.port === undefined && config.port ? { port: config.port } : {}),
			...(profile.username === undefined && config.user ? { username: config.user } : {}),
		};
		const identityFile = profile.identityFile ?? config.identityFile;
		return {
			profile: merged,
			...(identityFile ? { identityFile: resolveIdentityFile(identityFile) } : {}),
			jumpHosts: profile.jumpHosts ?? config.proxyJump ?? [],
		};
	}

	private async profileFor(alias: string): Promise<HostProfile> {
		const resolved = await this.options.hostResolver?.(alias);
		if (resolved) return resolved;
		const config = await readSshConfig(this.options.userSshConfigPath, alias);
		return {
			alias,
			host: config.hostName ?? alias,
			...(config.port ? { port: config.port } : {}),
			...(config.user ? { username: config.user } : {}),
			...(config.identityFile ? { identityFile: config.identityFile } : {}),
			...(config.proxyJump ? { jumpHosts: config.proxyJump } : {}),
		};
	}

	private async connectClient(profile: HostProfile, socket?: ClientChannel): Promise<Client> {
		const effective = await this.effective(profile);
		const credential = await this.options.credentials?.get(effective.profile);
		const config: ConnectConfig = {
			host: effective.profile.host,
			port: effective.profile.port ?? 22,
			username: effective.profile.username,
			readyTimeout: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
			keepaliveInterval: 15_000,
			keepaliveCountMax: 3,
			tryKeyboard: Boolean(credential?.keyboardInteractive),
			agentForward: false,
			...(socket ? { sock: socket } : {}),
			...(effective.identityFile ? { privateKey: await readFile(effective.identityFile) } : {}),
			...(credential?.privateKey
				? {
						privateKey:
							typeof credential.privateKey === "string"
								? credential.privateKey
								: Buffer.from(credential.privateKey),
					}
				: {}),
			...(credential?.passphrase ? { passphrase: credential.passphrase } : {}),
			...(credential?.password ? { password: credential.password } : {}),
			...(credential?.agent ? { agent: credential.agent } : {}),
			hostVerifier: (key: Buffer, verify: (valid: boolean) => void) => {
				void this.policy.verify(effective.profile, key).then(verify, () => verify(false));
			},
		};
		const client = new Client();
		return await new Promise<Client>((resolveClient, rejectClient) => {
			let settled = false;
			const fail = (error: Error) => {
				if (!settled) {
					settled = true;
					rejectClient(error);
				}
			};
			client.once("ready", () => {
				if (!settled) {
					settled = true;
					resolveClient(client);
				}
			});
			client.once("error", fail);
			client.connect(config);
			const keyboardInteractive = credential?.keyboardInteractive;
			if (keyboardInteractive)
				client.on(
					"keyboard-interactive",
					(name: string, instructions: string, _lang: string, prompts: Prompt[], finish) => {
						void keyboardInteractive(
							name,
							instructions,
							prompts.map((prompt) => prompt.prompt),
						).then(
							(answer) => finish(answer.map(String)),
							() => finish([]),
						);
					},
				);
		});
	}

	private async connect(): Promise<Client> {
		if (this.disposed) throw new ComputeTransportError("disposed", "SSH transport is disposed");
		const current = this.clients.at(-1);
		if (current) return current;
		if (this.connectionPromise) return this.connectionPromise;
		this.connectionPromise = (async () => {
			const effective = await this.effective(this.host);
			const chain = [...effective.jumpHosts, this.host.alias];
			let socket: ClientChannel | undefined;
			for (let index = 0; index < chain.length; index += 1) {
				const alias = chain[index];
				if (!alias) throw new ComputeTransportError("invalid-jump", "SSH jump chain contains an empty alias");
				const profile = await this.profileFor(alias);
				const client = await this.connectClient(profile, socket);
				this.clients.push(client);
				client.once("close", () => this.resetConnection(client));
				if (index < chain.length - 1) {
					const nextAlias = chain[index + 1];
					if (!nextAlias)
						throw new ComputeTransportError("invalid-jump", "SSH jump chain contains an empty alias");
					const next = await this.effective(await this.profileFor(nextAlias));
					socket = await new Promise<ClientChannel>((resolveSocket, rejectSocket) =>
						client.forwardOut("127.0.0.1", 0, next.profile.host, next.profile.port ?? 22, (error, channel) =>
							error ? rejectSocket(error) : resolveSocket(channel),
						),
					);
				}
			}
			const connected = this.clients.at(-1);
			if (!connected)
				throw new ComputeTransportError("connect-failed", "SSH connection did not produce a client", true);
			return connected;
		})().catch((error) => {
			this.connectionPromise = undefined;
			for (const client of this.clients.splice(0)) client.end();
			throw error;
		});
		return this.connectionPromise;
	}

	private resetConnection(_client: Client): void {
		// A final-hop disconnect invalidates every forwarded socket in the chain.
		// Drop all clients so the next operation establishes a fresh chain.
		for (const client of this.clients) {
			if (client !== _client) client.end();
		}
		this.clients = [];
		this.connectionPromise = undefined;
	}

	async runRunner(
		command: RunnerCommand,
		input: string,
		timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
	): Promise<TransportExecResult> {
		return await this.exec({
			argv: ["env", `DRONE_REMOTE_ROOT=${this.runnerRoot}`, "python3", this.runnerPath, command],
			stdin: input,
			timeoutMs,
		});
	}

	async exec(request: TransportExecRequest): Promise<TransportExecResult> {
		const client = await this.connect();
		const command = request.argv.map(shellQuote).join(" ");
		return await withTimeout(
			new Promise<TransportExecResult>((resolveResult, rejectResult) => {
				let finished = false;
				const fail = (error: Error) => {
					if (!finished) {
						finished = true;
						rejectResult(error);
					}
				};
				client.exec(command, (error, channel) => {
					if (error) return fail(error);
					const output = captureOutput(channel, channel.stderr, (bytes) => {
						if (!(bytes > (this.options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES))) return true;
						channel.destroy();
						fail(new ComputeTransportError("output-limit", "SSH response exceeds limit"));
						return false;
					});
					channel.once("error", fail);
					channel.once("close", (code: number | undefined) => {
						if (!finished) {
							finished = true;
							resolveResult({ exitCode: code ?? 0, ...output() });
						}
					});
					channel.end(request.stdin === undefined ? undefined : toBuffer(request.stdin));
				});
			}),
			request.timeoutMs ?? this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
			() => client.end(),
		);
	}

	private async sftp(): Promise<SFTPWrapper> {
		const client = await this.connect();
		return await new Promise<SFTPWrapper>((resolveSftp, rejectSftp) =>
			client.sftp((error, value) => (error ? rejectSftp(error) : resolveSftp(value))),
		);
	}

	private async mkdirp(sftp: SFTPWrapper, path: string): Promise<void> {
		const parts = path.replaceAll("\\", "/").split("/");
		let current = path.startsWith("/") ? "/" : "";
		for (const part of parts) {
			if (!part) continue;
			current = current ? `${current}/${part}` : part;
			await new Promise<void>((resolveMkdir, rejectMkdir) => {
				sftp.mkdir(current, (error) => {
					if (!error) return resolveMkdir();
					sftp.stat(current, (statError) => (statError ? rejectMkdir(error) : resolveMkdir()));
				});
			});
		}
	}

	async upload(request: Parameters<CollectingTransport["upload"]>[0]): Promise<void> {
		const destination = safeRemoteAbsolutePath(request.destination);
		const data = await readUpload(
			request.source,
			() => request.maxBytes ?? this.options.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES,
		);
		const sftp = await this.sftp();
		await this.mkdirp(sftp, dirname(destination));
		await new Promise<void>((resolveWrite, rejectWrite) => {
			const stream = sftp.createWriteStream(destination, { mode: 0o700 });
			stream.once("error", rejectWrite);
			stream.once("close", () => resolveWrite());
			stream.end(data);
		});
	}

	async download(request: Parameters<CollectingTransport["download"]>[0]): Promise<Uint8Array> {
		const source = safeRemoteAbsolutePath(request.source);
		const sftp = await this.sftp();
		const data = await new Promise<Buffer>((resolveData, rejectData) => {
			const chunks: Buffer[] = [];
			let size = 0;
			const stream = sftp.createReadStream(source);
			stream.on("data", (chunk: Buffer) => {
				size += chunk.byteLength;
				if (request.maxBytes !== undefined && size > request.maxBytes)
					stream.destroy(new ComputeTransportError("download-limit", "Download exceeds limit"));
				else chunks.push(Buffer.from(chunk));
			});
			stream.once("error", rejectData);
			stream.once("end", () => resolveData(Buffer.concat(chunks)));
		});
		if (request.destination) await writeFile(resolve(request.destination), data);
		return data;
	}

	async openShell(): Promise<ShellChannel> {
		const client = await this.connect();
		const channel = await new Promise<Channel>((resolveChannel, rejectChannel) =>
			client.shell((error, value) => (error ? rejectChannel(error) : resolveChannel(value))),
		);
		const stderr = (channel as Channel & { stderr?: AsyncIterable<Uint8Array> }).stderr ?? emptyBytes();
		return {
			stdin: writable(channel),
			stdout: channel,
			stderr,
			close: async () => channel.close(),
		};
	}

	async close(): Promise<void> {
		this.disposed = true;
		this.connectionPromise = undefined;
		for (const client of this.clients.splice(0).reverse()) client.end();
	}
}
