import type { AttemptRecord, FindingRecord, QuestionRecord } from "@drone/inquiry";

/** Structural bridge used by discovery; the host can pass InquiryService directly. */
export interface InquiryDiscoveryPort {
	recordQuestion(record: QuestionRecord): Promise<void>;
	recordAttempt(record: AttemptRecord): Promise<void>;
	recordFinding?(record: FindingRecord): Promise<void>;
}

/** Narrow structural port accepted by discovery and critic recorders. */
export interface InquiryCompatiblePort {
	readonly projectId?: string;
	readonly storage?: { readonly projectId: string };
	recordQuestion(record: QuestionRecord): Promise<void>;
	recordAttempt(record: AttemptRecord): Promise<void>;
}
