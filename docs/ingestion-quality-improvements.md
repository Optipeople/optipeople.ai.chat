# Ingestion Quality Improvements

Suggestions for raising knowledge-base quality. The ingestion pipeline today is barely an LLM pipeline — only one model call is involved (the OCR fallback), so most quality gains live outside the model choice.

## Current pipeline

1. **pdf-parse** (free, deterministic) — text-layer extraction
2. **Sonnet 4.6 vision** — OCR fallback for image-only / scanned PDFs ([src/lib/pdfText.ts:25](../src/lib/pdfText.ts#L25))
3. **Rule-based chunker** — recursive char splitter at 3500 chars / 400 overlap ([src/lib/ingestion.ts:79](../src/lib/ingestion.ts#L79))
4. **Voyage embeddings** — vector representation
5. **pgvector + hybrid RRF** — retrieval

## On model choice

**Keep Sonnet 4.6 on OCR.** For "extract every word in reading order," Sonnet 4.6 vision is already very strong. Opus 4.6 is ~5× the cost for marginal gain on a transcription task — Opus's reasoning advantage doesn't cash in on OCR. A scanned manual costs ~$1–2 on Sonnet; Opus would push it to $5–10.

The quality wins are elsewhere.

## Priority improvements

### 1. Smarter chunking

`chunkText` cuts every 3500 chars at the nearest paragraph/newline. It will happily slice a procedure, alarm table, or troubleshooting flow in half — which destroys retrieval for exactly the queries operators care about.

Options:
- **Heading-aware splitter**: detect section headings (numbered headings, all-caps lines, etc.) and prefer those as cut points.
- **Structure-preserving**: keep tables, step-lists, and code/parameter blocks intact even if oversized.
- **LLM-assisted semantic chunking** on a one-time pass: ask a model to identify natural section boundaries.

### 2. Page-aware chunks

[src/lib/ingestion.ts:350-351](../src/lib/ingestion.ts#L350-L351) — `page_from`/`page_to` are always `null` because Claude OCR returns one flat blob with no page markers. This breaks the "open PDF at page N" deep-link in the source chips under chat replies.

Fix: have the OCR prompt emit `<page n>` markers between pages, then parse them out into per-chunk page ranges during chunking. pdf-parse already exposes per-page text — use that path when extraction goes through pdf-parse instead of OCR.

### 3. LLM-generated doc summaries

[src/lib/ingestion.ts:292](../src/lib/ingestion.ts#L292) — `summary: input.summary ?? title`, which is usually just the filename. The chat's system prompt manifest lists each doc with its summary so Haiku can decide which to search ([src/app/api/chat/route.ts:131](../src/app/api/chat/route.ts#L131)). A one-paragraph LLM-generated summary per doc would meaningfully sharpen tool routing.

Cheap: one-time cost per ingest, done at ingest time (not per query). Could be Haiku to keep cost negligible.

### 4. Structured extraction

Alarms, parameter tables, and troubleshooting trees are buried in prose. A per-document index — "this manual covers alarms 700–799 and parameters P100–P250" — would let the model route searches better and answer some queries directly without retrieval.

One-time LLM pass at ingest. Store as JSON sidecar in `kb_documents` or a new `kb_document_index` table.

## Suggested order

1. Page markers in OCR + plumb pages into chunks (small, fixes a visible UX bug).
2. LLM doc summaries (small, cheap, immediate retrieval-quality win).
3. Heading-aware chunker (medium, biggest retrieval-quality win).
4. Structured extraction (larger, opens new product surface — direct answers, alarm lookup, etc.).
