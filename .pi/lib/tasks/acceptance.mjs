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
 * 同意决策仍在宿主：这里只登记「怎么核对」，从不登记「是否允许」。登记表是进程级的（Symbol 桥），
 * 与工具清单 / 知识发布桥同款，便于任务工作台、授权卡和说明文案共用一份定义。
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

const key = Symbol.for("drone.acceptance-verifiers.v1");
globalThis[key] ??= (() => {
	const kinds = [...CORE_ACCEPTANCE_KINDS];
	return {
		verifiers: new Map(),
		kinds,
		properties: { kind: { type: "string", enum: kinds }, path: stringField, sha256: stringField },
	};
})();
const registry = globalThis[key];
// 兼容更早的登记表实例（properties 里还没有核心字段）
registry.properties.kind ??= { type: "string", enum: registry.kinds };
registry.properties.path ??= stringField;
registry.properties.sha256 ??= stringField;

export function registerAcceptanceVerifier(kind, definition = {}) {
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
	registry.verifiers.clear();
	registry.kinds.splice(0, registry.kinds.length, ...CORE_ACCEPTANCE_KINDS);
	for (const field of Object.keys(registry.properties))
		if (!CORE_FIELDS.includes(field)) delete registry.properties[field];
}

export function acceptanceVerifier(kind) {
	return registry.verifiers.get(kind) || null;
}

export function acceptanceVerifiers() {
	return [...registry.verifiers.values()];
}

export function acceptanceKinds() {
	return [...registry.kinds];
}

/**
 * task_plan 的 acceptance JSON schema：`properties`（含 kind 枚举）整个是登记表里的活对象，
 * 后加载的扩展登记的种类与字段会同时出现在模型看到的 schema 和参数校验里。
 */
export function acceptanceSchema() {
	return {
		type: "object",
		properties: registry.properties,
		required: ["kind"],
		additionalProperties: false,
	};
}

/** 规范化模型提交的验收对象：核心字段 + 该种类声明的字段，其余丢弃。 */
export function normalizeAcceptance(input, clean, verifiers = registry.verifiers) {
	const kind = input?.kind;
	const verifier = verifiers.get(kind) || null;
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
