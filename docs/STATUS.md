# OptiAI — Current Status & Next Iteration

Living document. Reflects where the project is *right now* and the next chunk of
work to pick up. For long-term direction see [architecture.md](architecture.md);
for product framing see [overview.md](overview.md).

Last updated: 2026-05-10 (evening — iteration 3 complete + Phase 3 QR access).

---

## 1. Where we are

Iteration 3 is complete on `main`. Operator chat is persisted with
audit drilldown; the feedback loop closes end-to-end — operator
answers "Ja + here's what worked" → solution auto-promotes into the
machine's KB as a `source_type='feedback'` document, surfacing in
`search_kb` for the next operator with the same problem. Admins can
demote at any time by deleting the doc from the tree (the feedback row
stays, with `promoted_doc_id` cleared).

Phase 3 QR access also shipped. Each machine has a permanent revocable
QR token (stored on `machine_kb`). Operators scan a printed sticker
and land directly in the chat for that machine — no Optipeople login
required. The token IS the authorization; chat / feedback /
document-URL endpoints accept it via `X-QR-Token` header (mutually
exclusive with the bearer flow). Audit attribution: `entry_mode='qr'`
and `user_id='qr:<token-suffix>'`.

### What's live

| Layer | State |
|---|---|
| Hosting | Repo at [Optipeople/optipeople.ai.chat](https://github.com/Optipeople/optipeople.ai.chat). Vercel project linked, env vars set. |
| Frontend | Next.js 16 App Router. Operator login → account/machine pickers → chat (streaming). Deep-link `?account=…&machine=…` skips the pickers. |
| Backend (Next route handlers) | `/api/chat` (agentic, persisted), `/api/health`, `/auth-api/[...path]` (Optipeople proxy). |
| Database | Supabase project `wnswhzitolcfbfulchra` in eu-central-1. RLS on; service role bypasses. **9 migrations applied** — see [supabase/migrations/](../supabase/migrations/). |
| Storage | Supabase bucket `kb-documents` (private, 100 MB, PDF only). PDFs stored under `<machine_id>/<doc_id>.pdf`. |
| Embeddings | Voyage `voyage-4-large` @ 1024d (Matryoshka). Now on a paid plan — free-tier 3 RPM ceiling no longer applies; helper still retries on 429 defensively. |
| OCR fallback | Claude Sonnet 4.6 vision via streaming. Fires automatically when pdf-parse yields <500 chars or <400/page. Per-doc "Reprocess (OCR)" button on each document row. |
| Auth | Optipeople OAuth2 via dev proxy → real `/auth-api/[...]` route handler. Bearer token resolved server-side via `/api/User/GetCurrentUser` → `resolveCurrentUser()` in `src/lib/auth.ts`. |
| Admin UI | `/admin/machines` list + `/admin/machines/[id]` detail with: machine-name edit, drag-drop folder upload (full tree preserved, multi-file queue), folder tree view with DnD reorganise, "+ Ny mappe" + delete-empty-folder, view/download original PDF (signed URL), inline summary edit, document delete. **ScanEye** icon marks OCR-extracted docs; **MessageSquareQuote** marks feedback-promoted docs (PDF actions hidden for those rows — only delete is offered, which acts as demote). |
| Admin queue / progress | Persistent "Behandlingskø" panel. Reads from `kb_documents.progress` / `progress_label` so it survives refresh, polls every 3s while any doc is non-terminal. Server-side rows show a live progress bar through phases: `Læser PDF` → `Kører OCR…` → `Chunker` → `Embedder X/Y` → `Indsætter chunks`. |
| Conversation persistence | Every operator chat creates a `conversations` row + `messages` rows for user/assistant/tool turns. Tool messages capture the `kb_chunks` UUIDs the AI saw. Operator email + name denormalised onto conversations for cheap audit display. |
| Conversation audit UI | `/admin/machines/[id]/conversations` (paginated list) + `/admin/machines/[id]/conversations/[convId]` (full drilldown with messages, tool calls, expandable chunk text, token usage, cache-hit count, **feedback verdict + solution text**). |
| Resolution prompt | "Afslut samtale" button + 10-min idle auto-prompt → footer card with **Ja** / **Nej** + optional "Hvad virkede?" textarea on Ja. Posts to `/api/chat/feedback` → `feedback` row + `conversations.resolution` + `ended_at`. |
| Feedback → KB auto-promote | On "Ja + solution_text", the route synchronously builds a Q&A chunk (first user question + solution), embeds via Voyage, and inserts a `kb_documents` row of `source_type='feedback'` with the new chunk. `feedback.promoted_doc_id` is set. Re-submitting on the same conversation drops the prior promoted doc and re-promotes from the new answer. Admins demote by deleting the doc — `feedback.promoted_doc_id` becomes null via `on delete set null`. |
| Source chips in chat | Each assistant reply gets a "Kilder" row of clickable chips (one per unique document hit), deep-linked to the best-scoring page via `#page=N`. Backed by `/api/documents/[id]/url` (operator-auth, 10-min signed URL). Chat route streams a `sources` SSE event derived from search_kb results. |
| QR access | Per-machine permanent revocable token on `machine_kb.qr_token`. Operator scans `/?qr=<token>` → token resolved via `/api/qr/resolve` → stashed in sessionStorage → chat renders without login or pickers. `fetchWithAuth` sends `X-QR-Token` instead of bearer when in QR mode. Admin card on machine detail handles generate/regenerate/revoke; printable A4 page at `/admin/machines/[id]/qr` renders a QR sticker. |
| Admin → operator deep-link | `MessageSquare` icon on every machine row + "Test chat" button on the detail header opens `/?account=…&machine=…` in a new tab. |
| Confirm dialog | Branded `<ConfirmProvider>` + `useConfirm()` hook replaces `window.confirm`. Esc/Enter/click-outside, danger flag. |
| Knowledge base for the test machine | Felder (test) — `machine_id 700a3579-8cdf-4afa-2bb8-08db9ef8e885`, account `8452d639-8953-46ea-a57a-08db9ef8b057`. Document count drifts as we test reprocess flows; check `/admin/machines/<id>` for the live total. |

### What's NOT done yet

- **Phase 4 — Escalation** (~1 week per architecture). Per-account
  escalation target config, "escalate to human" button + snapshot
  endpoint, signed read-only transcript view for service techs.
- No production deploy verified through the browser yet (Vercel preview /
  prod URL hasn't been clicked through end-to-end since the iteration-3
  changes landed).
- Admin UI can only manage **existing** `machine_kb` rows. Creating a
  brand-new machine still requires the CLI; the UI doesn't pull from
  Optipeople's machine list.
- Long PDFs hitting the 5-min Vercel function timeout still fail — fine
  for typical manuals, would need async/queue if we hit it routinely.

### Key git commits (most recent first)

```
???     Iteration 3: progress bars, OCR threshold tune, reprocess + queue
38f9b6f Persist conversations + messages, add admin → chat deep-link
c4e7696 Folders: tree view with DnD, drag-import paths, explicit folder rows
b51a633 Admin UX polish: queue, confirm dialog, file viewer, OCR badge
48ebc48 OCR fallback for image-only PDFs via Claude vision
5cf3be1 Complete admin UI: detail page, ingest, edit, delete
13fcc43 Add /admin layout + machines list page
3083d56 Surface Optipeople role in UserMenu, gate on permissionName
09223d4 Gate requireSuperAdmin on Optipeople role instead of email allowlist
b8b147d Refactor: extract ingestion pipeline into src/lib/ingestion.ts
5bb212e Add STATUS.md handoff doc
1a860dc Iteration 1: agentic retrieval + Voyage ingestion pipeline
```

(The `???` line will resolve to whatever hash this commit lands on.)

### File map for the parts that matter most

| Concern | File |
|---|---|
| Operator chat (agentic loop, system prompt, search_kb tool, audit writes) | [src/app/api/chat/route.ts](../src/app/api/chat/route.ts) |
| Resolution prompt + auto-promote API | [src/app/api/chat/feedback/route.ts](../src/app/api/chat/feedback/route.ts) |
| Feedback → KB promotion helper | [src/lib/feedback.ts](../src/lib/feedback.ts) |
| Operator-accessible signed-URL endpoint | [src/app/api/documents/[id]/url/route.ts](../src/app/api/documents/%5Bid%5D/url/route.ts) |
| QR auth helper (server) | [src/lib/qrAuth.ts](../src/lib/qrAuth.ts) |
| QR resolve (public) + admin generate/revoke | [src/app/api/qr/resolve/route.ts](../src/app/api/qr/resolve/route.ts), [src/app/api/admin/machines/[id]/qr/route.ts](../src/app/api/admin/machines/%5Bid%5D/qr/route.ts) |
| QR session storage (client) | [src/auth/qrStorage.ts](../src/auth/qrStorage.ts) |
| QR print page | [src/components/admin/QrPrintView.tsx](../src/components/admin/QrPrintView.tsx) |
| Conversation persistence helpers | [src/lib/conversations.ts](../src/lib/conversations.ts) |
| Auth resolver (`resolveCurrentUser` + `requireSuperAdmin`) | [src/lib/auth.ts](../src/lib/auth.ts) |
| Hybrid search SQL function | [supabase/migrations/20260507141106_hybrid_search.sql](../supabase/migrations/20260507141106_hybrid_search.sql) |
| Per-machine ingestion CLI | [scripts/ingest.ts](../scripts/ingest.ts) |
| Ingestion pipeline (chunk + embed + progress writes) | [src/lib/ingestion.ts](../src/lib/ingestion.ts) |
| PDF text extraction with Claude OCR fallback | [src/lib/pdfText.ts](../src/lib/pdfText.ts) |
| Voyage embedding helper (with onBatchProgress hook) | [src/lib/voyage.ts](../src/lib/voyage.ts) |
| Admin upload + reprocess queue (provider + panel) | [src/components/admin/uploadQueue.tsx](../src/components/admin/uploadQueue.tsx) |
| Machine detail page (tree, DnD, edit) | [src/components/admin/MachineDetail.tsx](../src/components/admin/MachineDetail.tsx) |
| Conversation list (audit) | [src/components/admin/ConversationsList.tsx](../src/components/admin/ConversationsList.tsx) |
| Conversation drilldown | [src/components/admin/ConversationDetail.tsx](../src/components/admin/ConversationDetail.tsx) |
| Admin route handlers | [src/app/api/admin/](../src/app/api/admin/) |
| Schema (initial) | [supabase/migrations/20260506141924_initial.sql](../supabase/migrations/20260506141924_initial.sql) |
| Optipeople auth proxy | [src/app/auth-api/[...path]/route.ts](../src/app/auth-api/%5B...path%5D/route.ts) |
| Auth state (client) | [src/auth/AuthContext.tsx](../src/auth/AuthContext.tsx) |
| Confirm dialog primitive | [src/components/ui/confirm-dialog.tsx](../src/components/ui/confirm-dialog.tsx) |

### Schema — what each migration adds

| Migration | What |
|---|---|
| `20260506141924_initial.sql` | Tables + indexes for `machine_kb`, `kb_documents`, `kb_chunks`, `conversations`, `messages`, `feedback`, `escalations`. RLS on all of them. Storage bucket `kb-documents`. |
| `20260507141106_hybrid_search.sql` | `search_kb()` RPC — RRF over BM25 (text_tsv) + cosine on the embedding column. |
| `20260510100958_extraction_source.sql` | `kb_documents.extraction_source` (`'pdf-parse' \| 'claude-ocr'`) so the admin tree can show the violet ScanEye icon. |
| `20260510103314_folder_path.sql` | `kb_documents.folder_path` (slash-separated) for the folder tree. |
| `20260510104601_kb_folders.sql` | `kb_folders(machine_id, path)` so empty folders persist across deletes. |
| `20260510111126_conversation_user_details.sql` | `conversations.user_email` + `user_name` denormalised at insert time. |
| `20260510115801_doc_progress.sql` | `kb_documents.progress` (0–100) + `progress_label` for the live queue panel. |
| `20260510170000_machine_qr_token.sql` | `machine_kb.qr_token` (unique, nullable) + `qr_token_created_at` for permanent revocable QR access tokens. |

---

## 2. Cold-start a new dev machine

Everything below assumes a fresh checkout. Should take ~10 minutes.

### Prereqs

- Node ≥ 22 (the local PC uses Node 24)
- Git
- A working Anthropic API key (the previous one was auto-revoked when it
  ended up in a public repo — don't reuse anything from chat history).

### Steps

```bash
git clone https://github.com/Optipeople/optipeople.ai.chat.git
cd optipeople.ai.chat
npm install
```

Create `.env.local` at the repo root with these keys (values stay local —
never commit). Easiest source: Vercel CLI.

```bash
npx vercel link            # link the local checkout to the Vercel project
npx vercel env pull .env.local
```

Then check `.env.local` contains all of:

```
ANTHROPIC_API_KEY=...
VOYAGE_API_KEY=...
OPTIPEOPLE_API_TARGET=https://api-staging.optipeople.dk
SUPABASE_URL=https://wnswhzitolcfbfulchra.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
NEXT_PUBLIC_SUPABASE_URL=https://wnswhzitolcfbfulchra.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_DB_PASSWORD=...           # only used by the supabase CLI
```

If `vercel env pull` doesn't include `SUPABASE_DB_PASSWORD` (it's a CLI-only
secret, not actually a runtime env var), grab it from **Supabase dashboard
→ Settings → Database → Reset password**.

### Link the Supabase CLI on this machine

```bash
$env:SUPABASE_ACCESS_TOKEN = "<your PAT from supabase.com/dashboard/account/tokens>"
npx supabase link --project-ref wnswhzitolcfbfulchra --password "$env:SUPABASE_DB_PASSWORD"
```

### Run

```bash
npm run dev
# → http://localhost:3000
```

### Verify

```bash
# Health probe — all four checks should be ok:true
curl http://localhost:3000/api/health
```

Expected response (truncated):

```json
{
  "ok": true,
  "checks": {
    "anthropic_key": { "ok": true },
    "voyage_key":    { "ok": true },
    "optipeople_target": { "ok": true, "detail": "https://api-staging.optipeople.dk" },
    "supabase":      { "ok": true, "detail": "machine_kb rows: 1" }
  }
}
```

Then in a browser:

1. Open `http://localhost:3000`.
2. Log in with `mpg@optipeople.dk` (or any Optipeople-staging account
   with SuperAdministrator permission).
3. The user dropdown should show "ROLLE: Super Administrator". A
   **Admin** menu entry should appear.
4. Visit `/admin/machines`, click into Felder (test).
5. Test the operator chat via the **Test chat** button — should land
   you straight in the chat for that machine without the picker flow.
6. Ask: *"Hvordan fjerner jeg alarm 731?"*
7. Expected: a streamed Danish answer with the full procedure citing
   **Alarm 731 solution**.
8. Open `/admin/machines/<id>/conversations` — your test chat should
   show up; click into it to see the messages, tool calls, and chunks
   the AI retrieved.

### Useful test IDs (not secrets — visible in the auth API)

```
account_id = 8452d639-8953-46ea-a57a-08db9ef8b057   # the test Optipeople account
machine_id = 700a3579-8cdf-4afa-2bb8-08db9ef8e885   # Felder (test)
supabase project ref = wnswhzitolcfbfulchra
```

### Re-ingest manuals via the CLI (still supported, but the admin UI is the default path)

```bash
npm run ingest -- \
  --reset \
  --machine-id 700a3579-8cdf-4afa-2bb8-08db9ef8e885 \
  --account-id 8452d639-8953-46ea-a57a-08db9ef8b057 \
  --machine-name "Felder (test)" \
  knowledgebase/
```

`--reset` wipes existing `kb_documents` + chunks + Storage objects for
that machine before re-ingesting.

---

## 3. Iteration 2 — Admin UI (shipped + heavily polished)

Operator-facing super-admins manage manuals end-to-end through the
browser. Everything below is in production code on `main`:

- Server-gated by `permissionName === "SuperAdministrator"` from
  Optipeople. Client-side `<AdminGate>` hides chrome for non-admins
  but the server is the security boundary.
- Drag-and-drop multi-file upload with **folder tree preservation** —
  drop a whole `knowledgebase/` directory and the structure shows up
  in the admin tree, ready to be reorganised by drag.
- Per-doc actions: **view** (signed-URL new tab), **download** (forced
  attachment), **reprocess (OCR)** (queue-driven), **delete** (with
  custom confirm dialog).
- Inline edit on machine display name and per-doc summary.
- "+ Ny mappe" creates an empty folder; empty folders show a hover
  trash icon that calls a 409-gating delete endpoint.
- **Behandlingskø** panel persists across refresh by reading
  `kb_documents.progress` / `progress_label`. Polls every 3s while any
  doc is non-terminal. Sequential queue handles uploads + reprocess
  through a single Voyage rate-limit budget.
- Image-only PDFs auto-fall-back to **Claude Sonnet 4.6 vision**
  (streaming). Threshold: `< 500 chars total OR < 400 chars/page`.
  Existing docs can be reprocessed via the per-row button.
- Admin → chat deep-link from the list rows + detail header.

---

## 4. Iteration 3 — conversation persistence, audit, feedback

### Step 1 — Persist conversations + messages (✅ shipped)

`/api/chat` requires a bearer token, resolves the user via
`resolveCurrentUser`, creates a `conversations` row on first turn and
streams the id back as `event: conversation`. Every user/assistant/tool
turn is appended to `messages`. Tool messages carry the `kb_chunks`
UUIDs the search returned so audit views can reconstruct exactly what
the AI saw. Token usage + cache-hit are recorded per assistant row.
Audit writes are best-effort — failures log but don't break the live
chat.

### Step 2 — Conversation list page (✅ shipped)

`/admin/machines/[id]/conversations` — paginated 25/page, columns:
started, operator (name + email), message count, last activity,
resolution status. Click a row → drilldown.

### Step 3 — Conversation drilldown (✅ shipped)

`/admin/machines/[id]/conversations/[convId]` — chronological message
list with markdown-rendered assistant turns, expandable tool input
JSON, and the chunks each tool call returned (document title, chunk
ordinal, page range). Click a chunk row to expand its full text.
Header card shows total tokens (in/out) and cache-hit count.

### Step 4 — Resolution prompt (✅ shipped)

Operator gets a **"Afslut samtale"** pill button above the input once
the chat has at least one assistant reply. Clicking it (or 10 minutes
of idle, whichever comes first) surfaces a non-blocking footer card:
"Var dette nyttigt?" with **Ja** / **Nej**. **Ja** opens an optional
"Hvad virkede?" textarea (skippable); **Nej** submits immediately.
Submission posts to `POST /api/chat/feedback` which writes a `feedback`
row, sets `conversations.resolution` to `resolved`/`unresolved` and
stamps `ended_at`. Re-submitting overwrites the prior feedback row, so
the operator can change their mind before navigating away. After
submission the input bar locks and a "Start ny samtale" button appears.
Audit drilldown shows the feedback verdict + solution text in the
header card.

### Step 5 — Promote feedback to KB (✅ shipped, auto-promote model)

Decision: **auto-promote, admin-demote** rather than a pending review
queue. When the feedback route receives `resolved=true` with non-empty
`solution_text`, it synchronously calls `promoteFeedbackToKb()` (in
[src/lib/feedback.ts](../src/lib/feedback.ts)):

1. Fetches the conversation's first user message as the question.
2. Builds a Q&A chunk: `Spørgsmål fra operatør:\n<q>\n\nLøsning…\n<a>`.
   The question matters more than the answer for retrieval (next
   operator types something resembling the question, not the solution).
3. Embeds via Voyage (one chunk → one API call).
4. Inserts `kb_documents` row with `source_type='feedback'`,
   `status='ready'`, `storage_path=null`, `folder_path='Experience'`,
   `created_by=<operator email>`. Title format:
   `Operatørerfaring: <question, truncated 80 chars>`. The "Experience"
   folder is upserted into `kb_folders` so it shows in the tree even
   before the first promotion lands.
5. Inserts the chunk into `kb_chunks` with `embedding_model = voyage-4-large`.
6. Sets `feedback.promoted_doc_id` so the audit drilldown can show
   "forfremmet til KB".

If promotion fails for any reason, the `feedback` row + resolution
status still land — the operator's submission is the source of truth;
promotion is a downstream effect. Errors log to console.

**Re-submission**: if the operator changes their mind on the same
conversation, the route deletes the prior feedback row AND its
promoted doc (cascade kills chunks) before promoting from the new
answer. Keeps the KB consistent with the latest verdict.

**Demote**: super-admins delete the feedback-promoted doc from the
existing tree like any other doc. The schema's `feedback.promoted_doc_id
references kb_documents on delete set null` clears the link
automatically; the operator's verdict stays in the `feedback` table.

**Visual distinction**: feedback-promoted docs render with an emerald
**MessageSquareQuote** icon next to the title (mirrors the violet
ScanEye for OCR-extracted PDFs). The View / Download / Reprocess
action buttons are hidden on those rows — only the trash icon is
offered, with hover label "Demoter".

See [architecture.md §7](architecture.md) for the full phase plan
beyond iteration 3.

---

## 5. Things to do before any of this

- **Rotate every secret that touched chat** (Anthropic, Voyage, Supabase
  service role + DB password, Optipeople test creds). Free / staging
  creds, low blast radius, but cleaner before the first real customer.
- **Click through the production Vercel deploy end-to-end.** We've only
  verified locally since iteration 3 landed. Hit `<prod-url>/api/health`,
  test the whole upload-→-reprocess-→-chat-→-audit flow once.
- **Confirm the Turbopack catch-all crash isn't a real bug.** Has happened
  twice in dev mode (cleared by stopping the server, deleting `.next`,
  restarting). Production build is unaffected. If it recurs frequently,
  consider rewriting the `/auth-api/[...path]` proxy as `middleware.ts`.

---

## 6. Notes for the next session

- All migrations applied to remote Supabase already; nothing pending.
- Voyage is on a paid plan — the 25–40s retry waits in `voyage.ts`
  shouldn't fire in practice anymore, but the code stays as belt-and-
  suspenders.
- The admin queue panel was a key UX win — the operator can drop a
  folder of manuals, walk away, and refresh / come back to see the
  same per-doc progress bars. That pattern (poll + persist progress in
  the row's own columns) should also be the model for any future
  long-running ops (re-embedding model upgrades, bulk feedback
  promotions, etc.).
- Worth considering before iteration 4: re-embedding the whole KB on a
  new model (`machine_kb.active_embedding_model` already supports
  blue/green). Becomes useful when Voyage releases voyage-5 or we want
  to A/B a different embedding.
