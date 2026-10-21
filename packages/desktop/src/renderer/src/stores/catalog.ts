import type {
	CatalogPackage,
	CatalogPackageType,
	ConfiguredPackageInfo,
	PackageLifecycleOperation,
	PackageLifecycleReceipt,
	RegistryPluginMetadata,
} from "@drone/shared";
import { create } from "zustand";
import { getPi } from "../api";
import { useSettingsStore } from "./settings";
import { useUiPluginsStore } from "./ui-plugins";

interface CatalogStore {
	/** 扩展面板分段：浏览社区 / 已加载（进 store 保「切面板往返不丢 tab」） */
	extensionsTab: "browse" | "loaded";
	/** 社区包目录（pi.dev，服务端模糊搜索） */
	catalogQuery: string;
	catalogType: "" | CatalogPackageType;
	catalogPackages: CatalogPackage[];
	catalogTotal: number;
	catalogPage: number;
	catalogLoading: boolean;
	catalogLoadingMore: boolean;
	catalogError: string | null;
	/** 防陈旧响应：每次搜索自增，响应只认最新序号 */
	catalogSeq: number;
	/** 安装中的包名集合 */
	installingNames: Record<string, true>;
	/** 更新中的包名集合 */
	updatingNames: Record<string, true>;
	/** 按包名的安装错误 */
	installErrors: Record<string, string>;
	/** 按包名的更新错误 */
	updateErrors: Record<string, string>;
	/** 卸载中的 source 集合 */
	removingSources: Record<string, true>;
	/** 按 source 的卸载错误 */
	removeErrors: Record<string, string>;
	/** 最近一次生命周期回执；页面用它显示当前/下一会话生效边界。 */
	lifecycleReceipts: Record<string, PackageLifecycleReceipt>;
	/** settings.json 已配置的包（null = 未加载；「已安装」态匹配/卸载用） */
	configuredPackages: ConfiguredPackageInfo[] | null;
	setExtensionsTab: (tab: "browse" | "loaded") => void;
	setCatalogQuery: (query: string) => void;
	setCatalogType: (type: "" | CatalogPackageType) => void;
	/** 搜索社区包目录；append=true 时加载下一页并追加 */
	searchCatalog: (append?: boolean) => Promise<void>;
	/** 安装社区包（用户级），成功后刷新已配置列表与已加载资源 */
	installCatalogPackage: (name: string) => Promise<void>;
	/** 更新已安装社区包到 registry 最新版本 */
	updateCatalogPackage: (name: string) => Promise<void>;
	/** 卸载已配置的包，成功后刷新已配置列表与已加载资源 */
	removeConfiguredPackage: (source: string, scope: "user" | "project") => Promise<void>;
	refreshConfiguredPackages: () => Promise<void>;
	/** npm 上的最新版本（null = 查不到/离线；缺键 = 尚未检查） */
	latestVersions: Record<string, string | null>;
	checkingLatest: boolean;
	checkLatestVersions: (names: string[]) => Promise<void>;
	/** Registry declarations used by the pre-install confirmation. Null means unavailable. */
	pluginMetadata: Record<string, RegistryPluginMetadata | null>;
	loadingPluginMetadata: boolean;
	loadPluginMetadata: (names: string[]) => Promise<void>;
}

export const useCatalogStore = create<CatalogStore>((set, get) => {
	/** 目录搜索防抖（query/type 变更 300ms 后触发） */
	let catalogDebounceTimer: ReturnType<typeof setTimeout> | undefined;
	const scheduleCatalogSearch = () => {
		clearTimeout(catalogDebounceTimer);
		catalogDebounceTimer = setTimeout(() => void get().searchCatalog(false), 300);
	};

	return {
		extensionsTab: "browse",
		catalogQuery: "",
		catalogType: "",
		catalogPackages: [],
		catalogTotal: 0,
		catalogPage: 0,
		catalogLoading: false,
		catalogLoadingMore: false,
		catalogError: null,
		catalogSeq: 0,
		installingNames: {},
		updatingNames: {},
		installErrors: {},
		updateErrors: {},
		removingSources: {},
		removeErrors: {},
		lifecycleReceipts: {},
		configuredPackages: null,

		setExtensionsTab: (extensionsTab) => set({ extensionsTab }),

		setCatalogQuery: (catalogQuery) => {
			set({ catalogQuery });
			scheduleCatalogSearch();
		},

		setCatalogType: (catalogType) => {
			set({ catalogType });
			scheduleCatalogSearch();
		},

		searchCatalog: async (append = false) => {
			const { catalogQuery, catalogType, catalogPage, catalogSeq } = get();
			const page = append ? catalogPage + 1 : 1;
			const seq = catalogSeq + 1;
			set(
				append
					? { catalogSeq: seq, catalogLoadingMore: true, catalogError: null }
					: { catalogSeq: seq, catalogLoading: true, catalogError: null },
			);
			try {
				const result = await getPi().searchCatalog(catalogQuery, catalogType, page);
				if (get().catalogSeq !== seq) return; // 已有更新的搜索，丢弃陈旧响应
				set((state) => ({
					catalogPackages: append ? [...state.catalogPackages, ...result.packages] : result.packages,
					catalogTotal: result.total,
					catalogPage: result.page,
					catalogLoading: false,
					catalogLoadingMore: false,
				}));
			} catch (error) {
				if (get().catalogSeq !== seq) return;
				set({
					catalogLoading: false,
					catalogLoadingMore: false,
					catalogError: error instanceof Error ? error.message : String(error),
				});
			}
		},

		installCatalogPackage: async (name) => {
			set((state) => {
				const installErrors = { ...state.installErrors };
				delete installErrors[name];
				return { installingNames: { ...state.installingNames, [name]: true }, installErrors };
			});
			try {
				const receipt = await getPi().installPackage(name);
				set((state) => ({ lifecycleReceipts: { ...state.lifecycleReceipts, [name]: receipt } }));
				if (receipt.status === "failed") {
					set((state) => ({
						installErrors: {
							...state.installErrors,
							[name]: receipt.error?.message ?? "Package installation failed",
						},
					}));
					return;
				}
				await get().refreshConfiguredPackages();
				// backend 已对非流式会话做 session.reload()，刷新已加载资源列表让「已加载」页同步
				void useSettingsStore.getState().refresh();
				void useUiPluginsStore.getState().loadAll();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				set((state) => ({
					installErrors: { ...state.installErrors, [name]: message },
					lifecycleReceipts: {
						...state.lifecycleReceipts,
						[name]: failedReceipt("install", name, `npm:${name}`, "user", message),
					},
				}));
			} finally {
				set((state) => {
					const installingNames = { ...state.installingNames };
					delete installingNames[name];
					return { installingNames };
				});
			}
		},

		updateCatalogPackage: async (name) => {
			set((state) => {
				const updateErrors = { ...state.updateErrors };
				delete updateErrors[name];
				return { updatingNames: { ...state.updatingNames, [name]: true }, updateErrors };
			});
			try {
				const receipt = await getPi().updatePackage(name);
				set((state) => ({ lifecycleReceipts: { ...state.lifecycleReceipts, [name]: receipt } }));
				if (receipt.status === "failed") {
					set((state) => ({
						updateErrors: {
							...state.updateErrors,
							[name]: receipt.error?.message ?? "Package update failed",
						},
					}));
					return;
				}
				await get().refreshConfiguredPackages();
				void useSettingsStore.getState().refresh();
				void useUiPluginsStore.getState().loadAll();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				set((state) => ({
					updateErrors: { ...state.updateErrors, [name]: message },
					lifecycleReceipts: {
						...state.lifecycleReceipts,
						[name]: failedReceipt("update", name, `npm:${name}`, "user", message),
					},
				}));
			} finally {
				set((state) => {
					const updatingNames = { ...state.updatingNames };
					delete updatingNames[name];
					return { updatingNames };
				});
			}
		},

		latestVersions: {},
		checkingLatest: false,
		pluginMetadata: {},
		loadingPluginMetadata: false,
		checkLatestVersions: async (names) => {
			if (!names.length || typeof getPi().latestPackageVersions !== "function") return;
			set({ checkingLatest: true });
			try {
				const found = await getPi().latestPackageVersions(names);
				set((state) => ({ latestVersions: { ...state.latestVersions, ...found } }));
			} catch {
				// Offline or host without the method: rows fall back to the plain "installed" state.
			} finally {
				set({ checkingLatest: false });
			}
		},

		loadPluginMetadata: async (names) => {
			if (!names.length || typeof getPi().pluginPackageMetadata !== "function") return;
			set({ loadingPluginMetadata: true });
			try {
				const found = await getPi().pluginPackageMetadata(names);
				set((state) => ({ pluginMetadata: { ...state.pluginMetadata, ...found } }));
			} catch {
				set((state) => ({
					pluginMetadata: Object.fromEntries(names.map((name) => [name, state.pluginMetadata[name] ?? null])),
				}));
			} finally {
				set({ loadingPluginMetadata: false });
			}
		},

		refreshConfiguredPackages: async () => {
			try {
				const configured = await getPi().listConfiguredPackages();
				set({ configuredPackages: configured });
			} catch {
				set({ configuredPackages: [] });
			}
		},

		removeConfiguredPackage: async (source, scope) => {
			set((state) => {
				const removeErrors = { ...state.removeErrors };
				delete removeErrors[source];
				return { removingSources: { ...state.removingSources, [source]: true }, removeErrors };
			});
			try {
				const receipt = await getPi().removePackage(source, scope);
				set((state) => ({ lifecycleReceipts: { ...state.lifecycleReceipts, [source]: receipt } }));
				if (receipt.status === "failed") {
					set((state) => ({
						removeErrors: {
							...state.removeErrors,
							[source]: receipt.error?.message ?? "Package removal failed",
						},
					}));
					return;
				}
				await get().refreshConfiguredPackages();
				// backend 已对非流式会话做 session.reload()，刷新已加载资源列表让「已加载」页同步
				void useSettingsStore.getState().refresh();
				void useUiPluginsStore.getState().loadAll();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				set((state) => ({
					removeErrors: { ...state.removeErrors, [source]: message },
					lifecycleReceipts: {
						...state.lifecycleReceipts,
						[source]: failedReceipt("remove", source.replace(/^npm:/u, ""), source, scope, message),
					},
				}));
			} finally {
				set((state) => {
					const removingSources = { ...state.removingSources };
					delete removingSources[source];
					return { removingSources };
				});
			}
		},
	};
});

function failedReceipt(
	operation: PackageLifecycleOperation,
	packageName: string,
	source: string,
	scope: "user" | "project",
	message: string,
): PackageLifecycleReceipt {
	return {
		operation,
		packageName,
		source,
		scope,
		status: "failed",
		effect: "current-session",
		events: [{ type: "failed", at: Date.now(), detail: message.slice(0, 1000) }],
		error: { code: "operation-failed", message: message.slice(0, 1000), retryable: true },
	};
}
