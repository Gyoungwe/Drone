import type { zhHome } from "./home.zh";

export const enHome: typeof zhHome = {
	cards: {
		research: { title: "Research", hint: "From literature to conclusions", projects: "{count} projects" },
		knowledge: {
			title: "Knowledge",
			hint: "Search and recent deposits",
			metrics: "Notes {notes} · This week {deposits} · Pending {pending}",
		},
		relay: {
			title: "Relay",
			hint: "Continue the last task",
			unfinished: "Unfinished: {task}",
			recent: "Recent: {task}",
			none: "No unfinished task",
		},
		setup: "Set up the connection you need",
		example: "See a complete example first →",
		loading: "Reading live data…",
	},
	context: {
		topics: { title: "Active topics" },
		ideas: { title: "Today's discoveries" },
		radar: { title: "New literature" },
	},
	greeting: { morning: "Good morning", afternoon: "Good afternoon", evening: "Good evening" },
	intro:
		"From literature to conclusions — Drone searches, reads, analyzes and deposits into your knowledge base.",
	untitled: "Untitled session",
	workspace: {
		projects: "Projects",
		projectsEmpty: "No projects to show yet; start a task and it will appear here.",
		recent: "Recent sessions",
		recentHint: "Live history",
		recentEmpty: "No recent sessions yet.",
		running: "Running",
		viewAll: "View all",
	},
	environment: {
		title: "Workspace environment",
		connections: "Connection status",
		hosts: "Host status",
		model: "Model",
		knowledge: "Knowledge",
		compute: "Compute host",
		ready: "Available",
		configure: "Configure",
		checking: "Checking",
		noHosts: "No compute hosts configured",
		openConnections: "Open skills & connections",
	},
};
