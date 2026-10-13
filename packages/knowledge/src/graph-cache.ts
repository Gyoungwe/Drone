/**
 * Small revision-scoped cache for graph snapshots.
 *
 * Knowledge revisions are monotonic. Once the index changes, every cached
 * projection is stale, so a single revision boundary is enough to invalidate
 * all view/limit combinations without retaining old Vault data.
 */
export interface RevisionCache<T> {
	get(revision: number, key: string): T | undefined;
	set(revision: number, key: string, value: T): void;
	clear(): void;
}

export function createRevisionCache<T>(): RevisionCache<T> {
	let activeRevision: number | null = null;
	const values = new Map<string, T>();

	const align = (revision: number) => {
		if (activeRevision === revision) return;
		activeRevision = revision;
		values.clear();
	};

	return {
		get(revision, key) {
			align(revision);
			return values.get(key);
		},
		set(revision, key, value) {
			align(revision);
			values.set(key, value);
		},
		clear() {
			activeRevision = null;
			values.clear();
		},
	};
}
