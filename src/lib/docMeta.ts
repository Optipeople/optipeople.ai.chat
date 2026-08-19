// Per-document identity metadata, extracted once at ingest.
//
// Serves two fixes from docs/answer-correctness-plan.md:
//
//   F. Which product family a manual covers, so the model stops blending
//      an NJ-series table into an NX502 answer. One machine's knowledge
//      base legitimately holds several product families (CPU, servo, HMI),
//      and retrieval only filters by machine_id.
//
//   G. Which OTHER manuals this one defers to. A hardware manual that
//      gives switch settings and then says "for the procedure see W501"
//      is a trap when W501 is not in the knowledge base: on 2026-08-19 the
//      model filled that gap with an invented six-step procedure. Knowing
//      the reference exists lets the chat prompt say so instead.
//
// The catalog-number scan is a deterministic regex over the WHOLE text
// (high precision, full recall over a 400-page manual for the price of a
// string walk). The identity fields need judgement, so they come from one
// cheap model call over the front matter, which is where vendors put the
// cover page, the applicable-models table and the "relevant manuals"
// list.
//
// Never throws. Metadata is an enhancement: a document with none behaves
// exactly as it did before this module existed.

import Anthropic from "@anthropic-ai/sdk";
import {
  fromAnthropicUsage,
  recordUsage,
  type UsageAttribution,
} from "./usage";

// Haiku is the right tier here. This is extraction from text that is
// already in front of the model, not reasoning, and it runs once per
// document.
const META_MODEL = "claude-haiku-4-5-20251001";

// How much of the document the model sees. Front matter carries the
// identity; going deeper costs tokens for content the regex already
// covers.
const HEAD_CHARS = 30_000;

const MAX_TOKENS = 2000;

export const DOC_META_VERSION = 1;

export type DocumentMeta = {
  version: number;
  /** Full catalog number as printed, e.g. "W629-E1-09". Null if none. */
  catalogNo: string | null;
  /** Product series / model designations the manual applies to. */
  appliesTo: string[];
  /** Base catalog numbers of OTHER manuals this one cross-references. */
  references: string[];
  /** One-paragraph description for the tool-routing manifest. */
  summary: string | null;
};

export function emptyDocumentMeta(): DocumentMeta {
  return {
    version: DOC_META_VERSION,
    catalogNo: null,
    appliesTo: [],
    references: [],
    summary: null,
  };
}

// "Cat. No. W629-E1-09", "Cat.No. I586-E1-02", "Catalog No. W501".
// Deliberately narrow: a looser pattern picks up part numbers and model
// codes, and a false "this manual is missing" warning in an operator's
// answer is worse than no warning at all.
const CATALOG_RE =
  /Cat(?:alog)?\.?\s*No\.?\s*:?\s*([A-Z]{1,3}\d{3,4}(?:-[A-Z0-9]{1,4})*)/gi;

/**
 * Reduces a catalog number to the part that identifies the manual rather
 * than its revision: "W629-E1-09" and "W629-E1-05" are both "W629".
 */
export function catalogBase(catalogNo: string | null | undefined): string | null {
  if (!catalogNo) return null;
  const m = /^([A-Za-z]{1,3}\d{3,4})/.exec(catalogNo.trim());
  return m ? m[1].toUpperCase() : null;
}

/** Every distinct catalog number mentioned anywhere in the text, as bases. */
export function findCatalogReferences(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(CATALOG_RE)) {
    const base = catalogBase(m[1]);
    if (base) out.add(base);
  }
  return [...out].sort();
}

const PROMPT = `You are indexing one technical manual for a machine knowledge base. Answer ONLY with a JSON object, no prose and no code fence:

{
  "catalog_no": string | null,
  "applies_to": string[],
  "referenced_manuals": string[],
  "summary": string
}

- "catalog_no": this manual's own catalogue / document number exactly as printed (e.g. "W629-E1-09"). null if the text does not state one.
- "applies_to": the product series and model designations THIS manual documents, as printed (e.g. ["NX502-1400", "NX502-1300"] or ["NJ501 series"]). Empty array if the manual is not product-specific. Do not guess models that are only mentioned in passing.
- "referenced_manuals": catalogue numbers of OTHER manuals this one tells the reader to consult (e.g. ["W501", "W503"]). Base number only, no revision suffix. Empty array if none.
- "summary": one paragraph, at most 60 words, saying what an operator or technician can look up in this manual. Concrete and specific: name the systems, procedures or reference tables it covers. No marketing language, no "this manual describes".

Report only what the text supports. An empty array or null is the correct answer when the text does not say.`;

function parseMeta(raw: string): Partial<DocumentMeta> | null {
  let body = raw.trim();
  if (body.startsWith("```")) {
    const nl = body.indexOf("\n");
    if (nl !== -1) {
      body = body.slice(nl + 1);
      if (body.endsWith("```")) body = body.slice(0, -3);
    }
  }
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(body.slice(start, end + 1)) as Record<
      string,
      unknown
    >;
    const strings = (v: unknown): string[] =>
      Array.isArray(v)
        ? v
            .filter((x): x is string => typeof x === "string" && !!x.trim())
            .map((x) => x.trim())
        : [];
    return {
      catalogNo:
        typeof parsed.catalog_no === "string" && parsed.catalog_no.trim()
          ? parsed.catalog_no.trim()
          : null,
      appliesTo: strings(parsed.applies_to),
      references: strings(parsed.referenced_manuals),
      summary:
        typeof parsed.summary === "string" && parsed.summary.trim()
          ? parsed.summary.trim()
          : null,
    };
  } catch {
    return null;
  }
}

/**
 * Identity metadata for one document. Combines a deterministic scan of the
 * full text with one model call over the front matter, preferring the
 * regex for catalog numbers (it saw the whole document) and the model for
 * everything that needs reading comprehension.
 */
export async function extractDocumentMeta(args: {
  text: string;
  title: string;
  usage?: UsageAttribution;
}): Promise<DocumentMeta> {
  const scanned = findCatalogReferences(args.text);
  const meta = emptyDocumentMeta();

  let modelPart: Partial<DocumentMeta> | null = null;
  try {
    const anthropic = new Anthropic();
    const final = await anthropic.messages.create({
      model: META_MODEL,
      max_tokens: MAX_TOKENS,
      messages: [
        {
          role: "user",
          content: `${PROMPT}\n\nFile name: ${args.title}\n\nManual text (beginning):\n\n${args.text.slice(
            0,
            HEAD_CHARS,
          )}`,
        },
      ],
    });
    if (args.usage) {
      await recordUsage({
        ...args.usage,
        provider: "anthropic",
        model: META_MODEL,
        operation: "doc_metadata",
        ...fromAnthropicUsage(final.usage),
      });
    }
    modelPart = parseMeta(
      final.content.map((b) => (b.type === "text" ? b.text : "")).join(""),
    );
  } catch (err) {
    console.warn(
      "extractDocumentMeta: model call failed, falling back to the regex scan:",
      err instanceof Error ? err.message : err,
    );
  }

  meta.catalogNo = modelPart?.catalogNo ?? null;
  meta.appliesTo = modelPart?.appliesTo ?? [];
  meta.summary = modelPart?.summary ?? null;

  // A manual states its own number more often than it states any other,
  // so when the model found nothing, the first scanned number is the best
  // available guess at its identity.
  if (!meta.catalogNo && scanned.length > 0) meta.catalogNo = scanned[0];

  // References: union of both sources, minus this manual's own number.
  // The regex saw the whole document, the model only the front matter, so
  // neither alone is sufficient.
  const own = catalogBase(meta.catalogNo);
  const refs = new Set<string>();
  for (const r of [...scanned, ...(modelPart?.references ?? [])]) {
    const base = catalogBase(r);
    if (base && base !== own) refs.add(base);
  }
  meta.references = [...refs].sort();
  return meta;
}

// ---------------------------------------------------------------------------
// Chat-time helpers
// ---------------------------------------------------------------------------

/** Row shape the chat route reads out of kb_documents. */
export type DocumentMetaRow = {
  title: string;
  meta: unknown;
};

// The DB column is jsonb, so anything could be in there (older rows carry
// null). Normalise on read rather than trusting the shape.
export function readDocumentMeta(value: unknown): DocumentMeta {
  const meta = emptyDocumentMeta();
  if (!value || typeof value !== "object") return meta;
  const v = value as Record<string, unknown>;
  if (typeof v.catalogNo === "string") meta.catalogNo = v.catalogNo;
  if (Array.isArray(v.appliesTo)) {
    meta.appliesTo = v.appliesTo.filter((x): x is string => typeof x === "string");
  }
  if (Array.isArray(v.references)) {
    meta.references = v.references.filter(
      (x): x is string => typeof x === "string",
    );
  }
  if (typeof v.summary === "string") meta.summary = v.summary;
  if (typeof v.version === "number") meta.version = v.version;
  return meta;
}

/**
 * Catalog numbers referenced by the given documents that no document in
 * the same set provides. This is the "the procedure is in W501, which you
 * do not have" signal for the system prompt.
 */
export function missingReferencedManuals(
  docs: { meta: unknown }[],
): string[] {
  const present = new Set<string>();
  const referenced = new Set<string>();
  for (const d of docs) {
    const meta = readDocumentMeta(d.meta);
    const own = catalogBase(meta.catalogNo);
    if (own) present.add(own);
    for (const r of meta.references) {
      const base = catalogBase(r);
      if (base) referenced.add(base);
    }
  }
  return [...referenced].filter((r) => !present.has(r)).sort();
}
