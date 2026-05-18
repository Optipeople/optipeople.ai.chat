// Read and parse versioned legal markdown out of docs/legal/.
//
// The four documents live in the repo so they version-control alongside
// the code. Frontmatter carries the version we display at the top of
// the rendered page, which lets a human reader confirm they're looking
// at the same version that user_consent rows refer to.

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Locale } from "@/i18n/config";

export type LegalDocId = "terms" | "privacy";

export function isLegalDocId(v: unknown): v is LegalDocId {
  return v === "terms" || v === "privacy";
}

const FILE_MAP: Record<LegalDocId, Record<Locale, string>> = {
  terms: {
    en: "end-user-terms-en.md",
    da: "end-user-terms-da.md",
  },
  privacy: {
    en: "privacy-notice-en.md",
    da: "privacy-notice-da.md",
  },
};

export type LegalDocContent = {
  title: string;
  version: string;
  body: string;
};

// Minimal YAML frontmatter parser. Handles the simple key: value (or
// key: "value") shape we use in docs/legal/. A full parser would be
// overkill for four documents we control.
function parseFrontmatter(raw: string): {
  meta: Record<string, string>;
  body: string;
} {
  if (!raw.startsWith("---")) return { meta: {}, body: raw };
  const close = raw.indexOf("\n---", 3);
  if (close < 0) return { meta: {}, body: raw };
  const yaml = raw.slice(3, close).trim();
  const after = raw.slice(close + 4).replace(/^\r?\n/, "");
  const meta: Record<string, string> = {};
  for (const line of yaml.split(/\r?\n/)) {
    const m = line.match(/^([\w-]+):\s*"?(.*?)"?$/);
    if (m) meta[m[1]] = m[2];
  }
  return { meta, body: after };
}

export async function loadLegalDoc(
  doc: LegalDocId,
  locale: Locale,
): Promise<LegalDocContent | null> {
  const fileName = FILE_MAP[doc]?.[locale];
  if (!fileName) return null;
  const filePath = path.join(process.cwd(), "docs", "legal", fileName);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    return null;
  }
  const { meta, body } = parseFrontmatter(raw);
  return {
    title: meta.title ?? doc,
    version: meta.version ?? "",
    body,
  };
}
