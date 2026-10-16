export function filterResearchPaths(paths: readonly string[], query: string): string[] {
	const needle = query.trim().toLocaleLowerCase();
	return needle ? paths.filter((path) => path.toLocaleLowerCase().includes(needle)) : [...paths];
}
