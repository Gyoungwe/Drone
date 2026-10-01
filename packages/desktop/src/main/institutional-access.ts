import {
	InstitutionalService,
	openInstitutionalLoginWindow,
	openInstitutionalUrlInWindow,
} from "@drone/backend";

const service = new InstitutionalService();

export async function openInstitutionalLogin(url?: string): Promise<{ url: string }> {
	return openInstitutionalLoginWindow(url);
}

export async function openInstitutionalUrl(url: string): Promise<{ url: string }> {
	return openInstitutionalUrlInWindow(url);
}

export async function getStatus() {
	return service.getStatus();
}

export async function saveConfig(input: {
	ezproxyTemplate?: string;
	openUrlResolver?: string;
	institutionName?: string;
	autoDownloadEnabled?: boolean;
	perTaskLimit?: number;
}) {
	return service.saveConfig(input);
}

export async function clear() {
	return service.clear();
}

export async function testAccess(url: string) {
	return service.testAccess(url);
}
