// Thin client-side wrapper around /api/user/consent. The route handler
// owns version pinning and IP/UA capture — this module just types the
// calls and surfaces network errors back to the caller.

import { fetchWithAuth } from "./authApi";
import type { ConsentStatus } from "@/lib/consent";

export async function fetchConsentStatus(): Promise<ConsentStatus | null> {
  const res = await fetchWithAuth("/api/user/consent");
  if (!res.ok) return null;
  return (await res.json()) as ConsentStatus;
}

export async function postConsent(opts: {
  acceptTerms: boolean;
  acceptPrivacy: boolean;
  acceptAnalytics: boolean;
}): Promise<ConsentStatus> {
  const res = await fetchWithAuth("/api/user/consent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Consent save failed (${res.status})`);
  }
  return (await res.json()) as ConsentStatus;
}
