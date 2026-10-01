/**
 * 里程碑验收器登记表（挂钩 2）。
 *
 * 核心只认两种验收：`file`（宿主读回文件身份）和 `human_review`（用户在任务卡上亲自确认）。
 * 其它验收种类（zotero_item / wiki_review / …）由扩展调用 `registerAcceptanceVerifier(kind, definition)` 登记：
 *
 *   label(acceptance)          授权卡 / 说明文案里的一句话（如「文献进入 Zotero（doi）」）
 *   fields                     task_plan 里该种类允许的额外验收字段（如 doi / libraryId / collection）
 *   evidenceKind               完成时写进 milestone.evidence.kind 的记号（只描述宿主观察，不是科学结论）
 *   verify(acceptance, ctx)    里程碑级核对（reconcile 时调用）：返回 { state: "found" | "not-found" | "unknown" | ... , ...observed }
 *   observe(event, details)    操作级：某个工具结果是否产生了一个待外部审阅的对象 → { id, path? } | null
 *   identify(event, details)   操作级：某个成功的工具结果产生了可绑定到本种类里程碑的身份（如刚写入 Zotero 的 DOI）
 *                              → { doi, … }（只允许 fields 里声明的字段）| null。宿主把它绑到第一个尚无身份的
 *                              同种类里程碑（`milestone.bound`），随后仍由 verify 读回；绑定不授予任何写入同意。
 *   resolve(review, ctx)       操作级：读回审阅结果 → { status: "applied" | "pending" | "rejected", path?, stale? } | null
 *   operationVerifier          操作被 resolve 判定 applied 时写进 operation.verifier 的记号
 *   consent(acceptance)        任务授权后对外暴露的验收条目（如 { doi }），供扩展匹配「这次写入是否在已批准的契约内」
 *   pending(milestone)         未完成时给用户的说明 { reason, next }
 *   acknowledgeError           { code, message }：任务卡上的「确认」不能完成该里程碑时抛出的错误（如 Wiki 必须走审阅页）
 *
 * 同意决策仍在宿主：这里只登记「怎么核对」，从不登记「是否允许」。登记表存放在
 * DroneRuntime 的 tasks 槽位中，便于任务工作台、授权卡和说明文案共用一份定义，同时避免跨 host 共享可变状态。
 *
 * 登记时机：`kinds` 与 `properties` 都是活对象，task_plan 的参数 schema 按引用持有它们，因此在
 * task_plan 注册之后才加载的扩展（真实顺序里 obsidian-workbench 先于 zotero-literature）登记的
 * 种类 / 字段，模型看到的 schema 与参数校验一样能看到。但 pi 在第一次调用工具时才编译并缓存校验器
 * （按 schema 对象缓存），所以验收器必须在扩展加载阶段（第一轮模型调用之前）登记，
 * 不能等到某次工具调用之后再登记。
 */
export const CORE_ACCEPTANCE_KINDS = Object.freeze(["file", "human_review"]);
const CORE_FIELDS = Object.freeze(["kind", "path", "sha256"]);
const KIND = /^[a-z][a-z0-9_]{1,40}$/;
const FIELD = /^[a-zA-Z][a-zA-Z0-9]{0,40}$/;
const stringField = { type: "string", minLength: 1, maxLength: 512 };

import { runtimeSlot, withRuntime } from "../runtime-bridge.mjs";

/** Versioned event bridge used when an extension graph is loaded before its host runtime. */
export const ACCEPTANCE_VERIFIER_EVENT = "drone:acceptance-verifier/v1";
export const ACCEPTANCE_VERIFIER_REQUEST_EVENT = "drone:acceptance-verifier/request/v1";

// A Pi host may load more than one extension which imports this module. Keep the
// bridge installation idempotent per host object, while each runtime still owns
// the mutable verifier registry behind runtimeSlot().
const eventBridges = new WeakSet();

const createRegistry = () => {
	const kinds = [...CORE_ACCEPTANCE_KINDS];
	return {
		verifiers: new Map(),
		kinds,
		properties: { kind: { type: "string", enum: kinds }, path: stringField, sha256: stringField },
	};
};
/** @type {any} */
const registry = runtimeSlot("tasks", "acceptance", createRegistry, "drone.acceptance-verifiers.v1");
// 兼容更早的登记表实例（properties 里还没有核心字段）。这个修复必须
// 在每个 runtime 上懒执行：host runtime 可能在模块加载后才由 SessionEngine 注入。
function ensureRegistryShape() {
	registry.verifiers ??= new Map();
	registry.kinds ??= [...CORE_ACCEPTANCE_KINDS];
	registry.properties ??= {};
	registry.properties.kind ??= { type: "string", enum: registry.kinds };
	registry.properties.path ??= stringField;
	registry.properties.sha256 ??= stringField;
}
ensureRegistryShape();

function definitionOf(verifier) {
	const definition = {
		fields: [...(verifier.fields || [])],
		evidenceKind: verifier.evidenceKind,
		operationVerifier: verifier.operationVerifier,
	};
	for (const key of ["label", "verify", "observe", "resolve", "identify", "consent", "pending"])
		if (typeof verifier[key] === "function") definition[key] = verifier[key];
	if (verifier.acknowledgeError) definition.acknowledgeError = verifier.acknowledgeError;
	return definition;
}

function registrationOf(verifier) {
	return {
		version: 1,
		kind: verifier.kind,
		definition: definitionOf(verifier),
	};
}

/**
 * Bind the extension-local acceptance registry to a Pi event bus.
 *
 * Dynamic extensions are initialized before the inline host factory. Their
 * first registration therefore lands in the standalone runtime. The host
 * runtime announcement copies those definitions into the injected runtime and
 * publishes them through a versioned event. A host can also request a replay
 * after subscribing, which makes the load order explicit and testable.
 */
export function bindAcceptanceVerifierEvents(pi) {
	if (!pi?.events?.on || eventBridges.has(pi)) return () => {};
	eventBridges.add(pi);
	const publish = (verifier) => {
		void pi.events.emit?.(ACCEPTANCE_VERIFIER_EVENT, registrationOf(verifier));
	};
	const replay = () => {
		for (const verifier of acceptanceVerifiers()) publish(verifier);
	};
	const onRequest = (payload) => {
		if (payload?.version === 1) replay();
	};
	const onRuntime = (payload) => {
		if (payload?.version !== 1 || !payload.runtime || typeof payload.runtime !== "object") return;
		const verifiers = acceptanceVerifiers().map(registrationOf);
		if (!payload.runtime.scheduler) return;
		withRuntime(payload.runtime, () => {
			for (const registration of verifiers)
				registerAcceptanceVerifier(registration.kind, registration.definition);
		});
		for (const registration of verifiers) void pi.events.emit?.(ACCEPTANCE_VERIFIER_EVENT, registration);
	};
	pi.events.on(ACCEPTANCE_VERIFIER_REQUEST_EVENT, onRequest);
	pi.events.on("drone:runtime/v1", onRuntime);
	// The host may already have installed its collector; request a replay after
	// subscribing so registrations emitted during extension initialization are not
	// lost to a one-shot event.
	void pi.events.emit?.(ACCEPTANCE_VERIFIER_REQUEST_EVENT, { version: 1 });
	return () => {};
}

export function registerAcceptanceVerifier(kind, definition = {}) {
	ensureRegistryShape();
	if (!KIND.test(kind || "")) throw new Error(`Acceptance kind "${kind}" must match ${KIND}`);
	if (CORE_ACCEPTANCE_KINDS.includes(kind)) throw new Error(`Acceptance kind "${kind}" is owned by the host`);
	for (const fn of ["label", "verify", "observe", "resolve", "identify", "consent", "pending"])
		if (definition[fn] !== undefined && typeof definition[fn] !== "function")
			throw new Error(`Acceptance verifier ${kind}.${fn} must be a function`);
	const fields = [...new Set(definition.fields || [])];
	for (const field of fields)
		if (!FIELD.test(field) || CORE_FIELDS.includes(field))
			throw new Error(`Acceptance verifier ${kind}: invalid field "${field}"`);
	const verifier = Object.freeze({
		kind,
		fields: Object.freeze(fields),
		evidenceKind: definition.evidenceKind || `${kind}-verified`,
		operationVerifier: definition.operationVerifier || `${kind}-record-not-scientific-proof`,
		label: definition.label || (() => kind),
		verify: definition.verify || null,
		observe: definition.observe || null,
		resolve: definition.resolve || null,
		identify: definition.identify || null,
		consent: definition.consent || null,
		pending: definition.pending || null,
		acknowledgeError: definition.acknowledgeError || null,
	});
	registry.verifiers.set(kind, verifier);
	// 活的 schema：task_plan 可能在本扩展之前就已注册，枚举与字段对象按引用共享、原地追加
	if (!registry.kinds.includes(kind)) registry.kinds.push(kind);
	for (const field of fields) registry.properties[field] ??= stringField;
	return verifier;
}

/** 仅供测试：清空扩展登记的验收器。 */
export function resetAcceptanceVerifiers() {
	ensureRegistryShape();
	registry.verifiers.clear();
	registry.kinds.splice(0, registry.kinds.length, ...CORE_ACCEPTANCE_KINDS);
	for (const field of Object.keys(registry.properties))
		if (!CORE_FIELDS.includes(field)) delete registry.properties[field];
}

export function acceptanceVerifier(kind) {
	ensureRegistryShape();
	return registry.verifiers.get(kind) || null;
}

export function acceptanceVerifiers() {
	ensureRegistryShape();
	return [...registry.verifiers.values()];
}

export function acceptanceKinds() {
	ensureRegistryShape();
	return [...registry.kinds];
}

/**
 * task_plan 的 acceptance JSON schema：`properties`（含 kind 枚举）整个是登记表里的活对象，
 * 后加载的扩展登记的种类与字段会同时出现在模型看到的 schema 和参数校验里。
 */
export function acceptanceSchema() {
	ensureRegistryShape();
	return {
		type: "object",
		properties: registry.properties,
		required: ["kind"],
		additionalProperties: false,
	};
}

/** 规范化模型提交的验收对象：核心字段 + 该种类声明的字段，其余丢弃。 */
export function normalizeAcceptance(input, clean, verifiers) {
	ensureRegistryShape();
	const kind = input?.kind;
	const verifier = (verifiers || registry.verifiers).get(kind) || null;
	const acceptance = {
		kind,
		path: clean(input.path, 512),
		sha256: /^[a-f0-9]{64}$/.test(input.sha256 || "") ? input.sha256 : null,
	};
	for (const field of verifier?.fields || []) acceptance[field] = clean(input[field]);
	return acceptance;
}

/**
 * 里程碑的有效验收标准：已批准契约里的 acceptance + 宿主运行期绑定的身份字段（`milestone.bound.fields`）。
 * 契约本身（参与授权哈希）不被改写；绑定只补足计划时未知的身份（如精读后才确定的 DOI）。
 */
export function effectiveAcceptance(milestone) {
	const acceptance = milestone?.acceptance || {};
	const bound = milestone?.bound?.fields;
	return bound && typeof bound === "object" ? { ...acceptance, ...bound } : { ...acceptance };
}

/** 授权卡上一句话描述一个里程碑的验收标准。 */
export function describeAcceptance(acceptance, verifier = acceptanceVerifier(acceptance?.kind)) {
	if (acceptance?.kind === "file") return `生成文件 ${acceptance.path || ""}`.trim();
	if (acceptance?.kind === "human_review") return "由你亲自确认完成";
	if (verifier) {
		try {
			return String(verifier.label(acceptance) || verifier.kind);
		} catch {
			return verifier.kind;
		}
	}
	return `完成 ${acceptance?.kind || "未知"} 验收`;
}
