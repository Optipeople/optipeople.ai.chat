# Answer Correctness Plan (fixes A to H)

**Status: A to H are implemented and typechecking, lint-clean and building.
Two runtime steps remain, both listed in [§0](#0-implementation-status).**

Written 2026-08-19, the day Opti Assist gave a machine operator wrong DIP
switch settings for an OMRON NX502 CPU Unit, and implemented the same day.
The diagnosis in §1 and §2 is kept as written so the reasoning behind each
fix stays legible.

Related: [ingestion-quality-improvements.md](ingestion-quality-improvements.md)
(overlaps with fix B, see [§8](#8-reconciliation-with-the-existing-ingestion-doc)),
[architecture.md](architecture.md), [STATUS.md](STATUS.md),
[../evals/README.md](../evals/README.md).

---

## 0. Implementation status

| Fix | State | Where |
|---|---|---|
| P0 page provenance | done | [src/lib/chunking.ts](../src/lib/chunking.ts), [src/lib/pdfText.ts](../src/lib/pdfText.ts) |
| A preserve tables at ingest | done | [src/lib/pdfTables.ts](../src/lib/pdfTables.ts), [src/lib/pdfPageAnalysis.ts](../src/lib/pdfPageAnalysis.ts), [src/lib/pdfText.ts](../src/lib/pdfText.ts) |
| B table-atomic chunking + snippet cap | done | [src/lib/chunking.ts](../src/lib/chunking.ts), [src/app/api/chat/route.ts](../src/app/api/chat/route.ts) |
| C get_page_image | done | [src/app/api/chat/route.ts](../src/app/api/chat/route.ts) |
| D verbatim-first rule | done | both preambles in [src/app/api/chat/route.ts](../src/app/api/chat/route.ts), plus the voice preamble |
| E disagreement protocol | done | same |
| F product-family scoping | done | [src/lib/docMeta.ts](../src/lib/docMeta.ts), migration, manifest + hit payloads |
| G missing referenced manuals | done | [src/lib/docMeta.ts](../src/lib/docMeta.ts), both manifests |
| H eval suite | harness done, 6 cases | [scripts/eval.ts](../scripts/eval.ts), [../evals/](../evals/) |

### Two things left, both runtime rather than code

1. **Apply the migration BEFORE deploying the code.** The chat route now
   selects `kb_documents.meta`, and PostgREST rejects a select naming a
   column that does not exist, which would surface as a 500 on every chat
   turn. Order is: migration, then deploy.
   ```
   npx supabase db push
   ```
   ([supabase/migrations/20260819120000_doc_meta_and_table_extraction.sql](../supabase/migrations/20260819120000_doc_meta_and_table_extraction.sql))

2. **Reprocess the manuals.** Existing documents keep their old
   linearized text, their null page numbers and their null `meta` until
   they are reprocessed from the admin document page. Start with W629, run
   the evals, then work through the rest. Documents that have been through
   the table pass show a table badge in the admin tree, so the corpus can be
   worked through by eye.

Then: `EVAL_MACHINE_ID=<machine> npm run eval` against a running dev server.
Case 1 is the incident, and it is expected to FAIL before the reprocess and
pass after, which is also how the harness itself gets validated.

### Where the implementation deviates from the plan below

Six places, all with the measurement or the API fact that drove them:

1. **Table detection leads with geometry, not the text heuristic**
   ([§A](#a-preserve-tables-at-ingest) proposed text-shape first). pdf-parse's
   page renderer concatenates text items sharing a baseline with **no
   separator**, so a table row arrives as `WWarningMachine continues` with no
   column whitespace left to measure. The gap a text heuristic needs is
   destroyed before it could look at it. Confirmed on
   `demo-data/cnc-drilling/pdfs/06-error-codes.pdf` page 1, which extracts as
   `LetterSeverityEffect` / `WWarningMachine continues`. The text heuristic
   survives as an OR-ed fallback for PDFs that do preserve spacing.
2. **The detector deliberately over-selects.** Measured on the demo corpus:
   prose pages carry 4 to 8 distinct horizontal rule levels, ruled tables 15
   to 43, and vector technical drawings 10 to 12. Drawings sit inside the
   table range with no clean gap. Missing a table page leaves the bug that
   hurt an operator; a false positive costs a few cents and gets the page
   transcribed literally, so the thresholds take the false positives and
   `MAX_TABLE_PAGES` plus the ingest deadline bound the cost. The next signal
   to add, if the vision bill justifies it, is shared rule extent (a table's
   rules share an x-range, a dimension line's do not).
3. **The curve guard was measured and removed.** The first version rejected
   any page whose curve count outweighed its rules, reasoning that curves
   mean "drawing". It threw away real tables: a spec page with 40 horizontal
   and 14 vertical rules also carried 48 curves, all rounded corners on
   callout boxes.
4. **`get_page_image` returns the pages inside the `tool_result`.** The plan
   flagged this for verification and it checks out:
   `BetaToolResultBlockParam.content` accepts `BetaRequestDocumentBlock`, so
   no separate content block appended after the tool results is needed.
5. **Fix E makes the page lookup mandatory on contradiction.** The drafted
   wording offered "either look at the page or re-read the snippet", which
   leaves open the exact behaviour that caused the incident (re-reading the
   same text and getting more confident). The shipped rule is: call
   `get_page_image` and look, and fall back to re-reading only when there is
   no page to look at. That also makes [§7](#7-open-questions) question 4
   decided, and it is what lets the eval assert the tool call.
6. **`page_to` is exposed on search hits** when a chunk spans more than one
   page. Not in the plan, but chunks legitimately span page boundaries, and
   without it the model would ask for the wrong page for a table that sits on
   the second page of a hit's range.

Two additions beyond the plan's scope, both cheap and covering the same
failure for the same operators:

- **The voice path** got the compact form of D, E, F and G
  ([src/app/api/voice/realtime/session/route.ts](../src/app/api/voice/realtime/session/route.ts)).
  The plan scoped the prompt work to the two chat preambles, but an operator
  asking for a DIP switch position by voice is exposed identically, and voice
  cannot fall back to looking at the page, so its rules end at "tell them the
  page to look at".
- **An admin badge** for `extraction_source = 'pdf-parse+tables'`, so the
  corpus reprocess can be tracked by eye.

---

## 1. The incident

**Machine:** OMRON NX-series NX502 CPU Unit.
**Manual in the KB:** *NX-series NX502 CPU Unit Hardware User's Manual*, Cat. No.
W629-E1-09. Section 3-1-3, PDF pages 89 to 90 (printed pages 3-5 and 3-6).
**Operator question (Danish):** how do I back up the NX controller to an SD card.

### What the manual actually says

The DIP switch table in W629 §3-1-3 prints its switch columns in **descending**
order, 4 first and 1 last:

| Function | SW4 | SW3 | SW2 | SW1 |
|---|---|---|---|---|
| Backup | OFF | **ON** | OFF | OFF |
| Restore | **ON** | **ON** | OFF | OFF |
| Automatic transfer from SD Memory Card | OFF | OFF | **ON** | OFF |
| Safe Mode | **ON** | OFF | OFF | OFF |

Additional facts from the same section:

- Pin 1 is OFF in all four documented functions.
- Each function takes effect only after the CPU Unit is power-cycled with the
  new switch setting in place.
- W629 gives switch settings only. The actual backup, restore and
  auto-transfer **procedures** are in Cat. No. **W501**, and Safe Mode in
  **W503**. Neither W501 nor W503 is in this machine's knowledge base.

### What Opti Assist said

| Question | Correct | Opti Assist said | Consequence |
|---|---|---|---|
| Backup to SD card | pin **3** ON | pin **2** ON | Pin 2 ON alone is *Automatic transfer from SD Memory Card*, which copies the card **into** the controller. An operator trying to save the machine program to a card would have overwritten the live program with whatever was on the card. |
| Restore from SD card | pin **4** ON + pin **3** ON | pin **1** ON + pin **2** ON | Not a documented function at all. Pin 1 is OFF in every documented function. |

Three further behaviours in the same conversation:

1. **It doubled down twice** against the operator's correct pushback, including
   the assertion *"Manualen bekræfter det, jeg sagde tidligere, det er ikke pin
   3"* (the manual confirms what I said earlier, it is not pin 3). That was
   false, and it was stated with more confidence than the first answer.
2. **The restore error was never corrected.** After the operator pasted a
   screenshot of the page, the model corrected only the backup row and signed
   off offering to help with restore later. The wrong restore combination is
   still standing in that thread.
3. **It invented a 6-step backup procedure** that appears nowhere in W629. It
   admitted only in its final message that the procedure lives in W501, which
   is not in the KB.

### Why this class of error is worse than it looks

A wrong alarm-code explanation is visibly wrong within seconds. A wrong DIP
switch position looks plausible, does nothing observable if the SD card is
empty, and destroys a running program if it is not. It is silent until it is
catastrophic, and it is exactly the kind of question an operator asks Opti
Assist *because* they do not want to page through a 400-page hardware manual.

### Immediate operational follow-up (not a code change)

Correct the restore instruction with that operator directly. The thread ended
with the wrong value uncorrected.

---

## 2. Root cause

The column-to-value mapping **was never in the model's context**. This is
ingestion-layer data loss, not a model reasoning failure, which is why no
amount of prompt tuning alone can fix it.

The chain, in order:

### 2.1 pdf-parse linearizes the table

W629 has a real text layer, so it took the free deterministic path and the
vision path never ran. The gate is
[src/lib/pdfText.ts:155](../src/lib/pdfText.ts#L155): OCR only fires when text
yield is thin (`ABSOLUTE_MIN = 500` total, `MIN_CHARS_PER_PAGE = 400`,
[lines 37-38](../src/lib/pdfText.ts#L37-L38)). A native PDF full of tables is
the *best* case for that gate and the *worst* case for table fidelity.

pdf-parse flattens a table into a linear stream. The header row collapses to a
bare line reading roughly `4 3 2 1`, and the value rows become separate lines
reading `OFF ON OFF OFF`. Nothing binds a cell to its column any more. Given
that text, the near-universal left-to-right 1,2,3,4 prior wins, and the model
read the backup row as pin 2.

### 2.2 The chunker can separate the header from the rows

`chunkText` ([src/lib/ingestion.ts:84](../src/lib/ingestion.ts#L84)) is a
character splitter with zero structure awareness. `splitRecursive`
([line 60](../src/lib/ingestion.ts#L60)) breaks on `["\n\n", "\n", ". ", " ",
""]` and the merge pass packs to 3500 chars. A cut can land between the header
line and the value rows, at which point even a perfectly extracted table is
unreadable in isolation.

### 2.3 Snippets are truncated below the chunk size

Chunks are built at 3500 chars but truncated to `MAX_SNIPPET_CHARS = 2000`
before the model sees them
([src/app/api/chat/route.ts:524](../src/app/api/chat/route.ts#L524)), marked
`…[truncated]`. Up to 43% of every long hit is discarded. Embedding budget is
being spent on text the model is structurally prevented from reading. For a
table, the discarded tail may be the exact rows in question.

### 2.4 The model has no pixels

`search_kb` returns text, plus `image_alt` and `asset_id` for figure hits
([src/app/api/chat/route.ts:945](../src/app/api/chat/route.ts#L945)). The image
bytes are never sent. So the model's three "let me check the manual again"
searches could only re-read the same corrupted text, while its confidence rose
each time. The operator had to paste a screenshot to break the loop. The
`ImageBlockParam` plumbing already exists for operator photo attachments
([line 467](../src/app/api/chat/route.ts#L467)), it is simply not used for
search results.

### 2.5 The prompt has no value-lookup discipline

The grounding rule in both preambles is *"Ground every answer in the search_kb
results. If nothing relevant is found, say so plainly"*
([SYSTEM_PREAMBLE, line 136](../src/app/api/chat/route.ts#L136);
[FLEET_PREAMBLE, line 176](../src/app/api/chat/route.ts#L176)). There is no
requirement to quote a source row verbatim, no prohibition on re-rendering a
source table with a different column order, and no protocol for what to do when
the operator contradicts a specific value. The only safety line is generic:
remind the operator to follow site safety procedures.

### 2.6 Contributing: cross-family retrieval contamination

NJ-series chunks surfaced in NX502 queries. `search_kb` filters on `machine_id`
only
([supabase/migrations/20260507141106_hybrid_search.sql](../supabase/migrations/20260507141106_hybrid_search.sql)),
and one machine's KB legitimately holds several product families (CPU, servo,
HMI). Two vendors' or two series' tables can be blended into one answer with
nothing flagging it.

### 2.7 Contributing: silently missing referenced manuals

W501 is absent from the KB and nothing told the model that, so it filled the
gap from parametric memory instead of saying so.

### 2.8 No evals

There are no test or eval files anywhere in the repo. Nothing would have caught
this before shipping, and nothing will confirm a fix afterwards.

---

## 3. Design principles

These are the invariants the eight fixes serve. Worth re-reading before making
a judgement call not covered below.

1. **Structure loss at ingest is unrecoverable downstream.** Fix it where it
   happens. Everything else is mitigation.
2. **A hedge is cheaper than a wrong value.** "The text is ambiguous, look at
   page 89" costs the operator 30 seconds. A wrong pin costs a production run.
3. **The operator at the machine is a first-class evidence source.** They can
   see the page. The model cannot.
4. **Never assert agreement with a source without quoting it.** The most
   damaging single sentence in the incident was a false claim that the manual
   confirmed the model.
5. **Cost is a real constraint but not the binding one here.** Ingestion vision
   dominates the AI bill and chat is a rounding error
   ([route.ts:44-60](../src/app/api/chat/route.ts#L44-L60)). Spending chat
   tokens to be right is a good trade. Spending vision tokens on every page of
   every manual is not.

---

## 4. The fixes

Each fix lists the problem it closes, the design, the files it touches, its
acceptance criteria, and its risks.

---

### A. Preserve tables at ingest

**Closes:** [§2.1](#21-pdf-parse-linearizes-the-table). This is the root cause.

**Problem.** pdf-parse destroys column binding, and the OCR fallback that could
preserve it never runs on documents with a text layer. The OCR prompt would not
help anyway: it asks for literal text in reading order and says nothing about
tables ([src/lib/pdfText.ts:78-88](../src/lib/pdfText.ts#L78-L88)).

**Design.** Add a third extraction mode: a targeted table pass over only the
pages that carry tables.

1. **Detect table-bearing pages.** The pipeline already has per-page analysis
   for figures ([src/lib/pdfPageAnalysis.ts](../src/lib/pdfPageAnalysis.ts)),
   which counts image and vector-drawing operations per page and is cheap,
   local, and API-free. Add a table signal alongside it. Two candidate signals:
   - **Text shape** (recommended first): from per-page pdf-parse text (see
     [§5 P0](#p0-page-provenance-prerequisite)), count lines matching a
     multi-column pattern such as `/\S\s{2,}\S+\s{2,}\S/` and flag a page when
     4 or more such lines occur within a short window. Free, no new dependency,
     and it fires on exactly the layout that breaks.
   - **Geometry**: many short axis-aligned path segments indicate ruled cells.
     This needs a new pdf.js walk that inspects `constructPath` arguments
     rather than just counting operators. Higher effort, better recall on
     tables drawn with rules but sparse text. Add only if the text signal
     under-selects.
2. **Re-extract those pages with vision.** Slice them with
   [src/lib/pdfSlice.ts](../src/lib/pdfSlice.ts) and send as a `document`
   content block, which is how figure extraction already works
   ([src/lib/imageCaption.ts:156](../src/lib/imageCaption.ts#L156)). Map page
   numbers back with `toOriginalPage`. No rasterizer needed.
3. **Splice the result.** Replace the pdf-parse text of those pages with the
   returned Markdown, leaving every other page on the free path.

**The prompt is the deliverable here.** It must require, explicitly:

- Reproduce every table as a GitHub-flavored Markdown table.
- Reproduce header cells exactly as printed, in the printed left-to-right
  order. Never sort, renumber, or normalize them. If the header row reads
  `4 3 2 1`, the Markdown header must read `| 4 | 3 | 2 | 1 |`.
- Repeat the value in every column a merged cell spans.
- Keep the table's caption or number line immediately above the table.
- Emit page markers so page provenance survives.
- Do not summarize, do not add units, do not convert values, do not reorder
  rows.

The descending-header instruction is not hypothetical politeness. It is the
single instruction that fixes this incident, because a model asked to
"transcribe the table" will helpfully normalize `4 3 2 1` to `1 2 3 4` and
reintroduce the bug at a different layer.

**Caps.** Mirror the figure pass: a hard page cap per document (figures use
`MAX_FIGURE_PAGES = 150`, roughly $1 of Sonnet vision), and skip the slice when
the selection covers most of the document. Note that table pages are likely to
be a *larger* share of a manual than figure pages, so the cap will bind more
often. See [§7](#7-open-questions) question 1.

**Files:** [src/lib/pdfPageAnalysis.ts](../src/lib/pdfPageAnalysis.ts) (new
`tablePages()`), [src/lib/pdfText.ts](../src/lib/pdfText.ts) (new table pass,
spliced into `extractPdfText`), [src/lib/pdfSlice.ts](../src/lib/pdfSlice.ts)
(reused as is), [src/lib/usage.ts](../src/lib/usage.ts) (new operation label for
cost attribution, e.g. `table_extraction`).

**Acceptance.** After reprocessing W629, a `search_kb` for "DIP switch backup SD
card" returns a chunk whose text contains a Markdown table with the header
`| 4 | 3 | 2 | 1 |` and a row `| Backup | OFF | ON | OFF | OFF |`, and the
header and that row are in the **same** chunk.

**Risks.** Vision transcription can introduce its own errors on dense tables;
mitigated by fix C letting the model verify against the page and by fix H
catching regressions. Cost per ingest rises; bounded by the page cap.

---

### B. Table-atomic chunking, and fix the snippet size mismatch

**Closes:** [§2.2](#22-the-chunker-can-separate-the-header-from-the-rows) and
[§2.3](#23-snippets-are-truncated-below-the-chunk-size). Fix A is worthless
without this: a perfectly extracted table that gets cut in half, or truncated
before its last row, is back to being unreadable.

**Design.**

1. **Never split inside a table.** In `chunkText`, detect a contiguous run of
   GFM table lines (a trimmed line containing two or more `|`), extend it
   upward to absorb the caption line directly above, and treat the whole run as
   one atomic block that `splitRecursive` may not enter. If the block alone
   exceeds `target`, emit it as its own oversized chunk rather than splitting
   it.
2. **Embedding headroom is not a problem.** `planEmbedBatches` already sends a
   single oversized text on its own ([src/lib/voyage.ts](../src/lib/voyage.ts),
   `MAX_BATCH_TOKENS = 100_000`), and voyage-4-large accepts far more per input
   than any realistic table needs. Only if a table genuinely exceeds the
   per-input limit should it be split, and then only between rows, repeating
   the header row at the top of each part.
3. **Stop truncating tables.** The current `MAX_SNIPPET_CHARS = 2000` was
   justified on cost grounds: everything in a `tool_result` is re-billed as
   input on every later loop iteration. That reasoning holds for prose tails and
   fails for tables, where the tail is the payload. Recommended: exempt any
   chunk containing a table row from truncation, and raise the plain-text cap to
   about 3000 so ordinary chunks are no longer silently halved either. See
   [§7](#7-open-questions) question 2.

**Files:** [src/lib/ingestion.ts:60-99](../src/lib/ingestion.ts#L60-L99)
(`splitRecursive`, `chunkText`),
[src/app/api/chat/route.ts:524](../src/app/api/chat/route.ts#L524)
(`MAX_SNIPPET_CHARS`), [src/lib/searchKb.ts](../src/lib/searchKb.ts) (the voice
path returns untruncated text today, so only the chat path changes).

**Note on resumability.** `chunkText` must stay deterministic. The pipeline
recomputes the chunk list from the extraction sidecar to resume at the first
ordinal missing from `kb_chunks`
([src/lib/ingestion.ts:447-461](../src/lib/ingestion.ts#L447-L461)). Any change
that makes chunking depend on non-deterministic input breaks resume for
in-flight documents.

**Acceptance.** A fixture with a 40-row table produces one chunk containing the
header and all 40 rows. A hit on that chunk reaches the model with no
`…[truncated]` marker.

---

### C. Give the model eyes

**Closes:** [§2.4](#24-the-model-has-no-pixels). This is what turns "I checked
again and I stand by pin 2" into an actual check.

**Design.** A new tool, `get_page_image(document_id, page)`, returning the
rendered page for the model to look at.

- **No rasterizer required.** Slice 1 to 3 pages with `slicePdfPages` and send
  them as a `document` content block with base64 PDF data, exactly as
  [src/lib/imageCaption.ts:193](../src/lib/imageCaption.ts#L193) already does.
  This avoids adding a native PDF rendering dependency to a Vercel function.
- **Wiring.** `tool_result` blocks must come first in the user turn, so append
  the document block after the tool results in the same user message
  ([src/app/api/chat/route.ts:1513-1569](../src/app/api/chat/route.ts#L1513-L1569)),
  with the `tool_result` text naming the document and page that follow.
  *To verify at implementation time:* whether the API accepts a `document`
  block directly inside `tool_result.content`. If it does, use that instead, it
  is tidier and keeps the pairing explicit.
- **Caps.** At most 3 pages per call, at most 2 calls per turn. One page runs
  roughly 1500 to 3000 input tokens and is re-billed on each subsequent loop
  iteration, so an uncapped tool is a cost incident waiting to happen.
  `MAX_TOOL_ITERATIONS = 6` already bounds the loop
  ([route.ts:78](../src/app/api/chat/route.ts#L78)).
- **When to call it,** as a prompt rule paired with fix D: before stating a
  specific switch, pin, or parameter value that came from a table, and always
  when the operator disputes a value.
- **Fleet scope** needs `machine_id` plumbed through like the other fleet tools
  ([route.ts:303](../src/app/api/chat/route.ts#L303)).

**Dependency.** For text hits this needs a page number, which means
[P0](#p0-page-provenance-prerequisite) must land first: `kb_chunks.page_from`
is hard-coded to `null` today
([src/lib/ingestion.ts:484](../src/lib/ingestion.ts#L484)). Figure hits already
carry `kb_assets.page_from`, so a reduced version works before P0.

**Reduced variant (not sufficient).** When a hit has `is_image: true`, attach
that asset's page automatically. Cheaper to build, but it fires only on figure
hits, and the DIP table is a text hit. Do not ship this as the fix for C.

**Files:** [src/app/api/chat/route.ts](../src/app/api/chat/route.ts) (tool
schema, executor, tool-result assembly, both preambles),
[src/lib/pdfSlice.ts](../src/lib/pdfSlice.ts) (reused).

**Acceptance.** Replaying the DIP question shows a `get_page_image` call for
page 89 or 90 of W629, and a final answer naming pin 3.

---

### D. Verbatim-first rule for value lookups

**Closes:** [§2.5](#25-the-prompt-has-no-value-lookup-discipline).

**Design.** A new prompt section in both preambles. Rules:

- **Definition.** A *value answer* is any answer whose payload is a specific
  setting: switch or pin position, parameter number or value, torque, pressure,
  temperature, voltage, timing, part number, or menu path.
- Before stating such a value, **quote the source row verbatim** in a fenced
  block, then interpret it underneath.
- **Never re-render a source table with different column order, different
  headers, or renumbered columns.** If you reproduce a table, reproduce it as
  printed.
- **Column headers in manuals are not always ascending.** Read the header row
  that is actually present. Do not assume 1, 2, 3, 4.
- If the retrieved text does not unambiguously bind each value to its label,
  **say so**, quote what you have, point at the page, and verify with
  `get_page_image` rather than guessing.

`remark-gfm` is already a dependency ([package.json](../package.json)), so a
quoted Markdown table renders correctly in the operator UI.

**Files:** [src/app/api/chat/route.ts:136](../src/app/api/chat/route.ts#L136)
(`SYSTEM_PREAMBLE`) and [:176](../src/app/api/chat/route.ts#L176)
(`FLEET_PREAMBLE`).

---

### E. Disagreement protocol

**Closes:** the doubling-down and the uncorrected restore row.

**Design.** A second new prompt section, in both preambles. Rules:

- When the operator contradicts a specific value, **treat it as strong
  evidence**. They are standing at the machine and are often looking at the
  page.
- **Do not re-assert the same value from the same retrieved text.** Either
  fetch the page (fix C) or re-read the raw snippet specifically for structural
  ambiguity: column order, footnotes, units, which model or series the row
  applies to.
- **Never say the manual confirms you unless you quote the exact line that
  does, in the same message.**
- If it cannot be resolved from the source, say the text is ambiguous, quote
  what you have, and ask the operator to read the specific row off the page.
- **Correct the whole answer, not just the disputed part.** If one row of a
  table was wrong, re-derive every other value you gave from that same table
  and correct those too.

That last rule is the one that would have caught the restore error. The model
corrected the row it was challenged on and left the other wrong row standing,
because nothing told it that being wrong about one row of a misread table
implies being wrong about the rest.

**Files:** both preambles, as in D.

---

### F. Scope retrieval by product family

**Closes:** [§2.6](#26-contributing-cross-family-retrieval-contamination).

**Design.**

1. **Extract document identity at ingest.** One cheap model call per document
   yielding: catalog number (`W629-E1-09`), the product series and model
   designations the manual applies to (`NX502-1[]00`), and a real one-paragraph
   summary. The summary is item 3 of
   [ingestion-quality-improvements.md](ingestion-quality-improvements.md) and is
   free once this call exists.
2. **Store it** as a `meta jsonb` column on `kb_documents`. One migration, and
   it also carries fix G's cross-reference list. Prefer jsonb over several typed
   columns because the shape will grow.
3. **Surface it** on every `search_kb` hit and in the system-prompt manifest
   ([route.ts:568-576](../src/app/api/chat/route.ts#L568-L576)).
4. **Prompt rule.** For a value lookup, every row you quote must come from one
   document. If hits span documents with different `applies_to`, name the one
   you used and why. Never merge two manuals' tables into one answer.
5. **Optional hard filter, later.** Add a `p_document_ids` argument to the
   `search_kb` RPC so a follow-up search can be restricted to the document the
   model already established as authoritative. This is the real lever for
   "search only W629" and is cheap to add to both
   [search_kb](../supabase/migrations/20260507141106_hybrid_search.sql) and
   `search_kb_multi`
   ([20260813150000_fleet_mode.sql](../supabase/migrations/20260813150000_fleet_mode.sql)).

**Files:** new migration, [src/lib/ingestion.ts](../src/lib/ingestion.ts) (new
metadata pass), [src/app/api/chat/route.ts](../src/app/api/chat/route.ts) (hit
payload, manifest, preambles), [src/lib/searchKb.ts](../src/lib/searchKb.ts)
(voice path parity).

**Acceptance.** An eval case on a machine whose KB holds both an NJ-series and
an NX-series manual, where the correct answer exists only in the NX one, and the
answer must not quote the NJ table.

---

### G. Detect missing referenced manuals

**Closes:** [§2.7](#27-contributing-silently-missing-referenced-manuals).

**Design.**

1. **At ingest,** scan the extracted text for catalog-number cross-references
   (`Cat. No. W501`, `(Cat. No. W503)`), collect the distinct set, drop the
   document's own number, and store it in `meta.references` from fix F.
2. **At chat time,** `buildSystemPrompt` already loads the document manifest
   ([route.ts:527](../src/app/api/chat/route.ts#L527)). Add a line naming
   referenced catalog numbers that are **not** present among this machine's
   documents.
3. **Prompt rule.** If the answer depends on a procedure that the retrieved
   manual defers to another manual, and that manual is not in the knowledge
   base, say so up front and do not reconstruct the procedure. Give the settings
   you do have, and offer escalation via `[label](opti:call-service)`.

**Acceptance.** "How do I back up to an SD card" with only W629 present must
state that the step-by-step procedure is in W501, which is not in this machine's
knowledge base, and must not invent steps. This is the counterfactual for the
invented 6-step procedure.

---

### H. Eval suite

**Closes:** [§2.8](#28-no-evals). Fixes A to G remove this failure. H is what
keeps it removed.

**Design.** No test infrastructure exists and none needs to be introduced.
`tsx` is already a devDependency, so add `scripts/eval.ts` and an `npm run eval`
script, matching how `ingest` and `regenerate-suggestions` already work
([package.json](../package.json)).

- **Case shape.** One JSON file per case under `evals/cases/`, with: the
  question, the fixture machine, required assertions, forbidden strings, the
  expected source (document plus page), and a mode.
- **Assertions.** Deterministic substring and regex assertions first. Reach for
  model grading only for phrasing judgements ("did it hedge appropriately"),
  never for the value itself.
- **Two modes.**
  - `single`: ask once, assert on the final answer **and** on which tools were
    called. Asserting the tool calls is what catches a right answer reached by
    luck.
  - `pushback`: ask, then inject a scripted *wrong* correction, and assert the
    model holds its ground **with a quote**. This covers both observed failure
    modes at once: overconfidence without a quote, and capitulation to a
    confident wrong human.
- **Coverage target:** 30 to 50 cases across DIP and switch tables, alarm
  codes, torque values, parameter ranges, plus one case per fix (missing
  referenced manual for G, cross-family for F, figure-only content for C).
- **Case 1 is this incident,** with four assertions: backup is pin 3 ON only;
  restore is pin 4 plus pin 3 ON; auto-transfer is pin 2 ON; pin 1 is never ON.
- **Fixture.** Cases hit the real API and the real DB, so they need a stable
  corpus. Use a dedicated `evals` machine KB seeded by a script from a fixed set
  of PDFs, so a case's expected page number stays valid. See
  [§7](#7-open-questions) question 3.
- **Output.** Per-case pass or fail plus which assertion failed, written to
  `evals/out/<timestamp>.json`.
- **When to run it.** Any change to either preamble, `chunkText`,
  `extractPdfText`, `MAX_SNIPPET_CHARS`, or the search RPC.

---

## 5. Prerequisite work

### P0. Page provenance (prerequisite)

Not one of the eight fixes, but three of them depend on it, and it also fixes a
visible UX bug on its own.

**Problem.** `kb_chunks.page_from` and `page_to` are hard-coded `null`
([src/lib/ingestion.ts:484-485](../src/lib/ingestion.ts#L484-L485)), even though
the column exists in the schema and the `search_kb` RPC already returns it. So
the source chips under replies cannot deep-link to a page, the model cannot cite
a page for a text hit, and `get_page_image` has no page number to ask for.

**Design.**

1. pdf-parse exposes a per-page render hook, so per-page text can be captured
   during the same parse that already happens at
   [src/lib/pdfText.ts:133](../src/lib/pdfText.ts#L133). Have `extractPdfText`
   join pages with an explicit sentinel, for example `\n\n<<<page:N>>>\n\n`.
2. For the OCR and table-vision paths, instruct the model to emit the same
   sentinel.
3. Have the chunker record which sentinels a chunk spans, then **strip the
   sentinels from the stored text**. `kb_chunks.text_tsv` is a generated column
   over `text`
   ([initial migration](../supabase/migrations/20260506141924_initial.sql)), so
   leaving markers in would pollute the BM25 index.
4. `chunkText` returns `{ text, pageFrom, pageTo }[]` instead of `string[]`.

**Resume safety.** The extraction sidecar must store the sentinel-bearing text
so a continuation recomputes an identical chunk list
([src/lib/ingestion.ts:212](../src/lib/ingestion.ts#L212),
[:451](../src/lib/ingestion.ts#L451)). Add a version field to
`ExtractedSidecar` and treat an unversioned sidecar as invalid: the only cost is
re-extraction of a document that was mid-ingest during the deploy.

**Unblocks:** A (page selection and splicing), C (page numbers for text hits),
H (page assertions), and item 2 of
[ingestion-quality-improvements.md](ingestion-quality-improvements.md).

---

## 6. Sequencing

All of this is implemented; the table is kept because the ordering logic is
what a reviewer needs to check the work against, and because the re-ingest
and migration notes below it still apply.

Ordered by the ratio of risk removed to work required, not alphabetically.

| Order | Work | Why here | Re-ingest? | Migration? |
|---|---|---|---|---|
| 1 | **D + E** (prompt) | Prompt-only, ships same day, no dependencies. Cannot fix the data loss, but converts a confident wrong value into a hedged answer with a quote and a page pointer. That is the difference between an operator breaking production and an operator checking the page. | No | No |
| 2 | **H, first 3 cases** | A regression net before touching the pipeline. Case 1 must fail on today's `main`, which also validates the harness. | No | No |
| 3 | **P0** page provenance | Unblocks A, C and H page assertions. Fixes the dead deep-link as a side effect. | Yes | No |
| 4 | **A + B** | The actual root cause. Ship together: A without B still lets a chunk boundary or a truncation destroy the table. | Yes | No |
| 5 | **C** | Needs P0 for text hits. After A and B this is defence in depth rather than the primary fix, and it is what makes E's "go and check" instruction real. | No | No |
| 6 | **F + G** | Share one migration and one ingest-time metadata pass. | Yes | Yes |
| 7 | **H, full suite** | Grow to 30 to 50 cases once the shape is proven. | No | No |

**Why D and E come first even though they are mitigations.** They are reversible
in a single commit, they need no migration and no re-ingest, and they reduce the
blast radius of every remaining extraction defect, including ones not yet found.
Steps 3 and 4 are the real fix but they need a re-ingest pass over the corpus.

**Re-ingestion.** A changes extracted text, so every table-bearing manual must
be reprocessed. `reprocessPdf` already exists, is resumable, and is exposed in
the admin UI ([src/lib/ingestion.ts:723](../src/lib/ingestion.ts#L723),
[src/app/api/admin/documents/[id]/reprocess/route.ts](../src/app/api/admin/documents/%5Bid%5D/reprocess/route.ts)).
The embedding model does not change, so the blue/green
`machine_kb.active_embedding_model` path described in [STATUS.md](STATUS.md) is
not needed. Cost per document is one Voyage re-embed plus one Sonnet table pass.
Order: W629 first, run the evals, then the rest.

**Prompt-cache notes for D, E, F and G.** The cached prefix starts with the
account rules section, then the preamble
([route.ts:605-617](../src/app/api/chat/route.ts#L605-L617)). Editing a preamble
invalidates the prefix once per deploy, which is acceptable. `SYSTEM_PREAMBLE`
and `FLEET_PREAMBLE` are **deliberate copies, not a shared template**, precisely
so a fleet edit cannot perturb the machine-scope cache prefix
([route.ts:171-175](../src/app/api/chat/route.ts#L171-L175)). Keep both in sync
by hand and keep them separate. The same applies to `TOOLS` versus
`FLEET_TOOLS`.

---

## 7. Open questions

Four of these were decided during implementation. The reasoning is kept so
the numbers can be revisited rather than rediscovered.

1. **Cost ceiling for the table vision pass. DECIDED: 60 pages per
   document**, `MAX_TABLE_PAGES` in
   [src/lib/pdfPageAnalysis.ts](../src/lib/pdfPageAnalysis.ts), roughly
   $0.40 of vision input plus its Markdown output. Over the cap, the densest
   grids win and the rest are logged, never silently dropped. Batches are
   also cut off by the ingest deadline with 60 seconds of reserve, so a long
   document degrades to "some pages repaired" instead of failing. A pass cut
   short is not retried automatically: reprocess the document to finish it.
2. **`MAX_SNIPPET_CHARS`. DECIDED: both.** Table-bearing chunks are exempt
   from truncation entirely (the surgical fix, keeping the original cost
   argument for prose), and the prose cap went 2000 to 3000 so ordinary
   chunks are no longer silently halved either.
3. **Eval fixture location: STILL OPEN.** The harness currently points at a
   real machine via `EVAL_MACHINE_ID`, which works but ties page assertions
   to whatever revision of the manual that machine holds. A dedicated
   fixture machine seeded from fixed PDFs is still the right answer.
4. **Mandatory `get_page_image`. DECIDED: mandatory on contradiction,
   recommended otherwise.** Making it mandatory for every value answer costs
   latency on every question while the operator stands at the machine.
   Making it optional on contradiction leaves the door open to the exact
   behaviour that caused the incident. So the split is: a normal value
   answer may be answered from a clean table in the retrieved text; a
   disputed value must be checked against the page.
5. **Do escalation and feedback paths need to know** an answer was hedged for
   ambiguity? **STILL OPEN.** A hedged value answer is a signal that a
   document needs a better table pass, and it is currently invisible in the
   admin views. The cheapest version is probably a flag on the message row
   when the model says it could not resolve a value.

---

## 8. Reconciliation with the existing ingestion doc

[ingestion-quality-improvements.md](ingestion-quality-improvements.md) predates
this incident. Its four proposals map onto this plan as follows:

| That doc | Here |
|---|---|
| 1. Smarter chunking (heading-aware, structure-preserving, LLM-assisted) | **Fix B** implements the structure-preserving half, scoped to tables. Heading-aware splitting is still worth doing, but it is a retrieval-quality improvement, not a correctness fix, and it is not on this plan's critical path. |
| 2. Page-aware chunks | **P0**, promoted from a UX nicety to a prerequisite. |
| 3. LLM-generated doc summaries | Folded into **fix F**, which needs the same one-call-per-document metadata pass. |
| 4. Structured extraction (per-document alarm and parameter index) | Unchanged and still worthwhile. Not on this plan's path. |

**What that doc missed:** it identifies chunking as the weak link but never
names **table linearization and column-order loss**, which is the actual root
cause of this incident. Its suggested order (page markers, then summaries, then
heading-aware chunker, then structured extraction) would not have fixed the DIP
switch answer, because the column binding is already gone before the chunker
runs.
