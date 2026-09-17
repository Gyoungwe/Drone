import type { ContextUsageInfo } from "@drone/shared";

/** Per-effect lifetime and request ordering; one shared cancellation ref cannot distinguish old sessions. */
export function createContextUsageRefresh(
 fetchUsage: () => Promise<ContextUsageInfo | null>,
 update: (value: ContextUsageInfo | null) => void,
) {
 let alive = true;
 let request = 0;
 return {
  async refresh() {
   const current = ++request;
   try {
    const value = await fetchUsage();
    if (alive && current === request) update(value);
   } catch {
    if (alive && current === request) update(null);
   }
  },
  dispose() { alive = false; request++; },
 };
}
