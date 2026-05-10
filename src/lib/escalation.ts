// Escalation helpers — token minting + transcript snapshot shape shared
// between the operator-facing escalate endpoint and the tech-facing
// signed-link transcript endpoint.

import { randomBytes } from "node:crypto";

export type EscalationChannel = "phone" | "email" | "service_ticket";

// 24 random bytes → 32-char base64url. Same shape as the QR token; long
// enough that brute force isn't a concern, short enough to fit in a URL
// without wrapping. Permanent until row deletion or manual rotation.
export function mintShareToken(): string {
  return randomBytes(24).toString("base64url");
}

// Soft expiry. Enforced at lookup (404 past this point). Long enough to
// cover a typical service-tech round trip from "got the email" to
// "actually opened the link", short enough that stolen QR-photographed
// links don't live forever.
export const SHARE_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Snapshot stored in escalations.context_blob — the transcript view
// reads from this rather than re-querying messages, so the audit trail
// is immutable even if the conversation is later edited or its messages
// trimmed.
export type EscalationSnapshot = {
  machineId: string;
  machineName: string | null;
  accountId: string;
  startedAt: string;
  operator: {
    userId: string;
    email: string | null;
    name: string | null;
  };
  // Trimmed message stream — user/assistant only. Tool turns are skipped
  // since they're noise for techs (search queries, raw chunk dumps).
  messages: Array<{
    role: "user" | "assistant";
    content: string;
    createdAt: string;
  }>;
};
