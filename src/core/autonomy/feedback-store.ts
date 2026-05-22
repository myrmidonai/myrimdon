export type FeedbackCategory =
  | 'layout_wrong' | 'token_mismatch' | 'logic_error' | 'requirement_gap' | 'other';

export interface StructuredFeedback {
  category: FeedbackCategory;
  description: string;
  expectation: string;
  rejectedAt: string;
}

export function serializeFeedback(fb: StructuredFeedback): string {
  return JSON.stringify(fb);
}

export function parseFeedback(json: string): StructuredFeedback {
  return JSON.parse(json) as StructuredFeedback;
}

export function feedbackToContextBlock(fb: StructuredFeedback): string {
  return `## Feedback from prior rejection (${fb.rejectedAt})
Category: ${fb.category}
Problem: ${fb.description}
Expected: ${fb.expectation}`;
}
