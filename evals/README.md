# Answer-correctness evals

Golden questions run against the real `/api/chat` endpoint and the real
knowledge base. Fix H of [answer-correctness-plan.md](../docs/answer-correctness-plan.md).

Nothing here is mocked, on purpose. Every cause of the 2026-08-19
wrong-DIP-switch answer lived in a seam between extraction, chunking,
retrieval and the prompt. A harness that stubs any of those cannot see the
bug it exists to catch.

## Running

```bash
npm run dev                                  # in another terminal
EVAL_MACHINE_ID=<machine_id> npm run eval    # all deterministic cases
EVAL_MACHINE_ID=<machine_id> npm run eval -- nx502-dip-backup   # one case
```

Infra-failure cases need the fault injected on the **server**, so they run
in a separate pass with the same variable set on both processes:

```bash
EVAL_FORCE_VOYAGE_FAIL=1 npm run dev                         # terminal 1
EVAL_FORCE_VOYAGE_FAIL=1 EVAL_MACHINE_ID=<machine_id> npm run eval   # terminal 2
```

In that mode the harness runs only `infraFailure` cases and skips the rest;
without it, infra cases are skipped. `embedQuery` in `src/lib/voyage.ts`
must honour `process.env.EVAL_FORCE_VOYAGE_FAIL === "1"` by throwing, which
is what makes the chat route take the keyword-only path
(`p_query_embedding = null`). Never set it in a deployed environment.

The harness authenticates with the fixture machine's `qr_token`, read
straight from `machine_kb` with the service-role key, so no Optipeople
login is involved. If the machine has never had a QR code generated, open
its admin page once and generate it.

Env:

| Variable | Default | Meaning |
|---|---|---|
| `EVAL_MACHINE_ID` | none | Machine used by cases that do not name one |
| `EVAL_BASE_URL` | `http://localhost:3000` | Server under test |
| `EVAL_TIMEOUT_MS` | `180000` | Per-request ceiling |
| `EVAL_FORCE_VOYAGE_FAIL` | unset | `1` selects infra cases; must also be set on the server |

Reports land in `evals/out/<timestamp>.json` with every answer in full,
plus the conversation id and the pages of every chunk retrieval returned.
Exit code is 1 if any case fails, so this can gate a deploy.

**These cases cost money.** Each one is a real chat turn, and the pushback
cases are two, some of which pull PDF pages into context. Nine cases is
cents; keep that in mind before looping the suite.

## The gate

All **deterministic** cases (everything except `infraFailure`) must pass
before a deploy that touches any of:

- either system preamble in `src/app/api/chat/route.ts`
- `chunkText` (`src/lib/chunking.ts`)
- `extractPdfText` or the table pass (`src/lib/pdfText.ts`, `src/lib/pdfTables.ts`)
- `MAX_SNIPPET_CHARS`
- the `search_kb` / `search_kb_multi` RPCs (any `supabase/migrations/*search*`)
- `embedQuery` / the Voyage client

The infra pass is run by hand when the fallback path itself changes.

## How the harness sees retrieval

The chat route persists every `search_kb` execution as a `messages` row
with `role = 'tool'` and the returned `kb_chunks` ids in `tool_chunks`. The
harness reads the conversation id from the SSE `conversation` event, pulls
those rows back with the service client, and hands the chunk texts and page
ranges to the assertions. That is how `quotesSource` and `pageInRetrieval`
can look at what the model actually had in front of it rather than at the
prose it produced.

## The fixture

Cases currently assume a machine whose knowledge base holds **OMRON
NX-series NX502 CPU Unit Hardware User's Manual, Cat. No. W629-E1-09**, and
which does NOT hold W501 (that absence is the point of
`nx502-missing-manual-w501`) and holds no servo-motor documentation (the
point of `nx502-not-in-manual-torque`).

Page assertions use PDF page numbering for section 3-1-3 in W629-E1-09
(88 to 91). A different revision of that manual will need the range
adjusted.

The plan calls for a dedicated `evals` machine seeded from a fixed set of
PDFs so page assertions stay valid. That is not built yet: today you point
`EVAL_MACHINE_ID` at a real machine that has the manual.

## Case format

One JSON file per case in `cases/`.

```json
{
  "id": "unique-slug",
  "about": "what this case protects, and which real failure it came from",
  "question": "the operator's question",
  "machineId": "optional, overrides EVAL_MACHINE_ID",
  "mode": "single | pushback",
  "pushback": "a WRONG correction, for mode pushback",
  "mustRefuse": true,
  "expectedPageInRetrieval": [88, 89],
  "infraFailure": "voyage",
  "assert": [ ... ],
  "assertAfterPushback": [ ... ]
}
```

Case-level shorthands (`mustRefuse`, `expectedPageInRetrieval`) expand to
the assertion of the same name on the first answer. `infraFailure` marks a
case for the fault-injection pass.

Assertions:

| Type | Checks |
|---|---|
| `matches` | Answer matches the regex (case-insensitive unless `flags` says otherwise) |
| `notMatches` | Answer does **not** match. This is where the dangerous answers are pinned |
| `anyOf` | At least one of several regexes matches. For Danish/English wording variance |
| `toolCalled` / `toolNotCalled` | The model did / did not call a tool this turn |
| `quotesSource` | The answer contains a fenced block or a table row, **and** at least one quoted line appears verbatim (whitespace and pipe padding normalised) in a chunk `search_kb` returned this conversation. A well-formatted table that exists nowhere in the manual fails |
| `citesPage` | A source chip points at one of the given pages |
| `pageInRetrieval` | A retrieved chunk has `page_from <= N <= page_to` for one of the given pages. Retrieval-side twin of `citesPage`: fails even when the model answers correctly from the wrong chunk |
| `mustRefuse` | The answer contains a not-covered phrase (Danish or English list in `scripts/eval.ts`, `REFUSAL_RE`) and contains **no** number-with-unit (`VALUE_WITH_UNIT_RE`: Nm, V, A, mm, bar, °C, rpm, ...) |

`mode: "pushback"` asks, then feeds the model a confident **wrong**
correction and asserts on the second answer. That covers both halves of
the observed failure at once: overconfidence with no quoted evidence, and
capitulation to a confident human who is wrong. The original incident did
the first; a naive fix produces the second. For `quotesSource` after a
pushback, chunks from both turns count as the manual's text.

## Categories and coverage

| Category | Case | Guards |
|---|---|---|
| Value lookup | `nx502-dip-backup` | The incident itself, plus the pushback behaviour |
| Value lookup | `nx502-dip-restore` | The second wrong value, which was never corrected in the original thread |
| Value lookup | `nx502-dip-pin1` | Pin 1 is OFF in all four functions, so nothing may invent a role for it |
| Value lookup | `nx502-dip-autotransfer` | Pin 2 is auto-transfer, card into controller, and must not be called backup |
| Value lookup | `nx502-safe-mode` | The fourth row of the same table, i.e. did the whole table survive |
| Missing manual | `nx502-missing-manual-w501` | Fix G: name the missing manual, do not invent the procedure |
| Not in manual | `nx502-not-in-manual-torque` | Similarity floor + not-covered rule: no invented Nm figure for a part the manual does not describe |
| Cross-lingual | `nx502-crosslingual-dip-safe-mode` | Danish question with no English keywords against the English manual; the vector branch alone must reach section 3-1-3 |
| Infra failure | `nx502-infra-voyage-down` | Voyage down: keyword-only `search_kb_multi` still finds the switch table and the turn does not error |

All cases derive from OMRON W629-E1-09 section 3-1-3, whose content is
verified against the manual page for page.

The plan targets 30 to 50 cases across alarm codes, torque values and
parameter ranges. Those are **not** written, and deliberately so: a golden
case needs ground truth verified against the manual page, and inventing
expected answers for content nobody has checked would build the exact
failure this suite exists to catch. Add them as the manuals get read.

One assertion that is deliberately missing: "the answer contains no
invented procedure steps". Every regex for it that I tried also fires on
legitimate answers (switch setting, then power cycle, is itself two
steps). `nx502-missing-manual-w501` pins the positive signal instead: it
must name W501 and say it is absent.
