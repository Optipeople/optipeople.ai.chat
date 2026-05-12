// Escalation helpers — token minting + transcript snapshot shape shared
// between the operator-facing escalate endpoint and the tech-facing
// signed-link transcript endpoint.

import { randomBytes } from "node:crypto";
import { getTranslations } from "next-intl/server";

export type EscalationChannel =
  | "sms"
  | "email"
  | "service_ticket"
  | "webhook";

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

// Outbound payload for the 'webhook' channel. Stable, versioned shape so
// downstream ticketing integrations can pin against it. The shareUrl is
// the auth token to the read-only transcript view — the receiving system
// is expected to relay it to a service tech rather than store it
// long-term.
export type EscalationWebhookPayload = {
  type: "optipeople.escalation.created";
  version: 1;
  escalationId: string;
  conversationId: string;
  machine: { id: string; name: string | null };
  account: { id: string };
  operator: { userId: string; email: string | null; name: string | null };
  note: string | null;
  shareUrl: string;
  expiresAt: string;
  startedAt: string;
  // Same trimmed user/assistant stream the tech-facing transcript view
  // shows — included verbatim so downstream systems can attach the full
  // conversation to a ticket without a callback.
  transcript: Array<{
    role: "user" | "assistant";
    content: string;
    createdAt: string;
  }>;
};

export class WebhookError extends Error {
  status: number;
  body: string | null;
  constructor(message: string, status: number, body: string | null) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

// 10s ceiling — long enough for a typical helpdesk webhook to ack, short
// enough that a stalled customer endpoint doesn't burn the whole route's
// 5-minute budget.
const WEBHOOK_TIMEOUT_MS = 10_000;

export async function sendEscalationWebhook(
  url: string,
  payload: EscalationWebhookPayload,
): Promise<{ status: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "OptiAI-Webhook/1",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    const t = await getTranslations("server.webhook");
    if (err instanceof Error && err.name === "AbortError") {
      throw new WebhookError(
        t("timeout", { seconds: WEBHOOK_TIMEOUT_MS / 1000 }),
        0,
        null,
      );
    }
    throw new WebhookError(
      err instanceof Error ? err.message : t("networkError"),
      0,
      null,
    );
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => null);
    const t = await getTranslations("server.webhook");
    throw new WebhookError(
      t("responseStatus", { status: res.status }),
      res.status,
      body ? body.slice(0, 500) : null,
    );
  }
  return { status: res.status };
}
