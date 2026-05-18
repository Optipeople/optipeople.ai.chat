// Versioned end-user consent identifiers.
//
// Bumping any version constant invalidates the corresponding row in
// user_consent for every user and forces a re-prompt at next login.
// Keep these in sync with the version field in the matching markdown
// under docs/legal/. When the legal text changes, bump the date here
// and in the frontmatter of all four documents.

export const TERMS_VERSION = "2026-05-18";
export const PRIVACY_VERSION = "2026-05-18";
export const ANALYTICS_VERSION = "2026-05-18";

export type ConsentDocument = "terms" | "privacy" | "analytics";

export const CONSENT_DOCUMENTS: readonly ConsentDocument[] = [
  "terms",
  "privacy",
  "analytics",
];

export function isConsentDocument(v: unknown): v is ConsentDocument {
  return v === "terms" || v === "privacy" || v === "analytics";
}

export function currentVersionFor(doc: ConsentDocument): string {
  switch (doc) {
    case "terms":
      return TERMS_VERSION;
    case "privacy":
      return PRIVACY_VERSION;
    case "analytics":
      return ANALYTICS_VERSION;
  }
}

export type ConsentRecord = {
  document: ConsentDocument;
  version: string;
  accepted: boolean;
  acceptedAt: string;
};

export type ConsentStatus = {
  terms: ConsentRecord | null;
  privacy: ConsentRecord | null;
  analytics: ConsentRecord | null;
  needsConsent: boolean;
};

// A user "needs consent" when either mandatory doc is missing or out of date.
// Analytics is optional, so the absence of an analytics record never gates
// access — the screen still asks once so the user has a chance to opt in.
export function computeNeedsConsent(
  terms: ConsentRecord | null,
  privacy: ConsentRecord | null,
): boolean {
  if (!terms || !terms.accepted || terms.version !== TERMS_VERSION) return true;
  if (!privacy || !privacy.accepted || privacy.version !== PRIVACY_VERSION)
    return true;
  return false;
}
