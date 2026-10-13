import "./app.css";
import { createRoot } from "react-dom/client";
import { scenes } from "./scenes";

// 最小 window.pi 桩：截图只渲染组件，不连主进程
(window as unknown as { pi: unknown }).pi = new Proxy(
	{ platform: "linux" },
	{ get: (t: Record<string, unknown>, k: string) => (k in t ? t[k] : () => Promise.resolve(undefined)) },
);
const params = new URLSearchParams(location.search);
const name = params.get("scene") || "";
document.documentElement.dataset.theme = params.get("theme") === "dark" ? "dark" : "light";
const Scene = scenes[name];
createRoot(document.getElementById("root") as HTMLElement).render(
	Scene ? <Scene /> : <pre>{Object.keys(scenes).join("\n")}</pre>,
);
