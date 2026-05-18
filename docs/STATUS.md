# Opti Assist — Current Status & Next Iteration

Living document. Reflects where the project is *right now* and the next chunk of
work to pick up. For long-term direction see [architecture.md](architecture.md);
for product framing see [overview.md](overview.md).

Last updated: 2026-05-10 (late night — webhook escalation channel,
per-machine escalations list, ingestion timeout watchdog).

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

Phase 4 escalation also shipped. Per-account escalation targets
(`escalation_targets` table, configured by super-admins on any
machine page — the card label notes the setting is shared across the
account). Operator hits a "Tilkald service" pill button → optional
note → `POST /api/chat/escalate` snapshots the conversation, mints a
30-day share token, writes an `escalations` row, and stamps the
conversation with `resolution='escalated'`. Phone targets open `tel:`,
e-mail targets open `mailto:` with the share URL in the body, and
service-ticket targets surface a copy-to-clipboard share URL. The
service tech opens `/escalation/<token>` — no login — and reads the
frozen transcript snapshot. Audit drilldown surfaces the escalation
above the feedback card with channel/target + a click-through to the
tech-facing link.

Admin can now **create and delete machines** end-to-end from the
browser. The machines list has a "Tilføj maskine" button that opens a
two-combobox dialog (account → machine, both populated from the live
Optipeople API and intersected against existing `machine_kb` rows so
already-onboarded machines are disabled). Submit creates the empty KB
row; the new machine detail page is one click away. The detail page
header has a matching "Slet maskine" button that wipes the storage
folder + cascades `kb_documents` / `kb_chunks` / `kb_folders` via FK,
while leaving conversation/feedback/escalation history intact (no FK to
`machine_kb`).

Three follow-ups to Phase 4 also shipped this round:

- **Webhook escalation channel.** A fourth `escalation_targets.channel`
  value, `'webhook'`. When configured, the operator's "Tilkald service"
  click POSTs a stable JSON payload (`type:
  optipeople.escalation.created`, version 1, escalationId, conversation
  snapshot, signed share URL) to the configured URL. Hard-fails like the
  email channel — no escalations row lands if the receiving endpoint
  returns non-2xx or times out (10s ceiling). Used for customers who
  want programmatic ticket creation in their existing helpdesk.
- **Per-machine escalations list.** New `/admin/machines/[id]/escalations`
  page mirroring the conversations audit pattern: paginated, channel
  badge, redacted target, operator, note preview, click-through to the
  tech-facing share URL or to the full conversation drilldown. Linked
  from the machine detail header next to "Samtaler".
- **Ingestion 5-min budget + watchdog.** `withIngestBudget` races every
  ingest/reprocess against a 270 s timer (Vercel kills at 300 s, leaves
  30 s slack to flip the row to `failed` and respond). Operator sees a
  Danish-language error in the queue panel: *"Tidsgrænse på 5 min nået
  — del PDF'en op i mindre filer eller kontakt support@optipeople.dk"*.
  HTTP 504 returned to the upload client. A passive watchdog
  (`cleanupStuckDocuments`, called from the machine detail GET) flips
  any in-pipeline doc with no progress writes for 6 min to failed —
  catches the cases where the function instance died before its own
  timer could fire (OOM, deploy roll, network drop).

The operator login pickers now **filter to onboarded machines only**.
A new public `GET /api/registered` returns the set of `machine_id` and
`account_id` values present in `machine_kb`. The auth context
intersects Optipeople's accounts/machines lists with that set before
rendering the pickers, so operators never land on an account or
machine that this Opti Assist instance can't actually serve. Empty
states point to `support@optipeople.dk` instead of "contact your
administrator", since onboarding is on Optipeople.

### What's live

| Layer | State |
|---|---|
| Hosting | Repo at [Optipeople/optipeople.ai.chat](https://github.com/Optipeople/optipeople.ai.chat). Vercel project linked, env vars set. |
| Frontend | Next.js 16 App Router. Operator login → account/machine pickers → chat (streaming). Deep-link `?account=…&machine=…` skips the pickers. |
| Backend (Next route handlers) | `/api/chat` (agentic, persisted), `/api/health`, `/auth-api/[...path]` (Optipeople proxy). |
| Database | Supabase project `wnswhzitolcfbfulchra` in eu-central-1. RLS on; service role bypasses. **11 migrations applied** — see [supabase/migrations/](../supabase/migrations/). |
| Storage | Supabase bucket `kb-documents` (private, 100 MB, PDF only). PDFs stored under `<machine_id>/<doc_id>.pdf`. |
| Embeddings | Voyage `voyage-4-large` @ 1024d (Matryoshka). Now on a paid plan — free-tier 3 RPM ceiling no longer applies; helper still retries on 429 defensively. |
| OCR fallback | Claude Sonnet 4.6 vision via streaming. Fires automatically when pdf-parse yields <500 chars or <400/page. Per-doc "Reprocess (OCR)" button on each document row. |
| Auth | Optipeople OAuth2 via dev proxy → real `/auth-api/[...]` route handler. Bearer token resolved server-side via `/api/User/GetCurrentUser` → `resolveCurrentUser()` in `src/lib/auth.ts`. |
| Admin UI | `/admin/machines` list + `/admin/machines/[id]` detail with: **"Tilføj maskine"** dialog (account/machine comboboxes pulling from Optipeople, dedup against existing `machine_kb` rows), machine-name edit, **"Slet maskine"** (wipes storage + cascades `kb_documents`/chunks/folders, keeps audit history), drag-drop folder upload (full tree preserved, multi-file queue), folder tree view with DnD reorganise, "+ Ny mappe" + delete-empty-folder, view/download original PDF (signed URL), inline summary edit, document delete. **ScanEye** icon marks OCR-extracted docs; **MessageSquareQuote** marks feedback-promoted docs (PDF actions hidden for those rows — only delete is offered, which acts as demote). |
| Operator picker filter | `GET /api/registered` returns the `machine_id` / `account_id` sets from `machine_kb`. The auth context intersects Optipeople's account + machine lists with these sets so operators only see what this Opti Assist instance is actually onboarded for. Public endpoint — IDs only, no names. |
| Admin queue / progress | Persistent "Behandlingskø" panel. Reads from `kb_documents.progress` / `progress_label` so it survives refresh, polls every 3s while any doc is non-terminal. Server-side rows show a live progress bar through phases: `Læser PDF` → `Kører OCR…` → `Chunker` → `Embedder X/Y` → `Indsætter chunks`. **Timeout safety**: ingest/reprocess race a 270s budget timer (Vercel kills at 300s); on fire, the row flips to `failed` with a Danish-language label and the route returns 504. A passive watchdog (called from the machine detail GET) flips any in-pipeline doc with no progress writes for 6 min to failed — covers cases where the function instance died before its own timer fired. |
| Conversation persistence | Every operator chat creates a `conversations` row + `messages` rows for user/assistant/tool turns. Tool messages capture the `kb_chunks` UUIDs the AI saw. Operator email + name denormalised onto conversations for cheap audit display. |
| Conversation audit UI | `/admin/machines/[id]/conversations` (paginated list) + `/admin/machines/[id]/conversations/[convId]` (full drilldown with messages, tool calls, expandable chunk text, token usage, cache-hit count, **feedback verdict + solution text**). |
| Resolution prompt | "Afslut samtale" button + 10-min idle auto-prompt → footer card with **Ja** / **Nej** + optional "Hvad virkede?" textarea on Ja. Posts to `/api/chat/feedback` → `feedback` row + `conversations.resolution` + `ended_at`. |
| Feedback → KB auto-promote | On "Ja + solution_text", the route synchronously builds a Q&A chunk (first user question + solution), embeds via Voyage, and inserts a `kb_documents` row of `source_type='feedback'` with the new chunk. `feedback.promoted_doc_id` is set. Re-submitting on the same conversation drops the prior promoted doc and re-promotes from the new answer. Admins demote by deleting the doc — `feedback.promoted_doc_id` becomes null via `on delete set null`. |
| Source chips in chat | Each assistant reply gets a "Kilder" row of clickable chips (one per unique document hit), deep-linked to the best-scoring page via `#page=N`. Backed by `/api/documents/[id]/url` (operator-auth, 10-min signed URL). Chat route streams a `sources` SSE event derived from search_kb results. |
| QR access | Per-machine permanent revocable token on `machine_kb.qr_token`. Operator scans `/?qr=<token>` → token resolved via `/api/qr/resolve` → stashed in sessionStorage → chat renders without login or pickers. `fetchWithAuth` sends `X-QR-Token` instead of bearer when in QR mode. Admin card on machine detail handles generate/regenerate/revoke. Sticker is downloaded as a 1200×1500 PNG (logo + machine name + QR rendered to canvas) at `/admin/machines/[id]/qr` — preview-then-download, no browser print. |
| Service escalation | Per-account target row in `escalation_targets` (channel = `phone` \| `email` \| `service_ticket` \| `webhook`, target, label). Configured via the **MachineEscalationCard** on any machine detail page (admin sees a "shared across the account" hint). Operator chat shows a "Tilkald service" pill next to "Afslut samtale" once a conversation exists. Submit → `POST /api/chat/escalate` snapshots the conversation into `escalations.context_blob`, mints a 30-day share token, sets `resolution='escalated'`. **Phone**: client opens `tel:` to the target. **Email**: server sends via Resend (`Opti Assist <noreply@optipeople.dk>`, EU region) with the share URL in the body — hard-fails the request if Resend rejects, so operator knows mail didn't go out. **Service-ticket**: client surfaces share URL for copy/paste. **Webhook**: server POSTs the conversation snapshot + signed share URL as JSON to the configured URL; hard-fails on non-2xx or 10s timeout. Service tech opens `/escalation/<token>` — public, token-gated — and reads the frozen transcript. Audit drilldown surfaces the escalation as an amber card above the feedback verdict with a click-through to the tech link. **Per-machine list** at `/admin/machines/[id]/escalations` paginates every escalation for the machine. |
| E-mail delivery | Resend, EU region, sender `Opti Assist <noreply@optipeople.dk>`. SDK wrapped in [src/lib/email.ts](../src/lib/email.ts). Domain DNS verified at the registrar; `RESEND_API_KEY` + `RESEND_FROM` mirrored to Vercel for both preview and production. Reply-to is set to the operator's e-mail when available so techs reply to the operator, not the no-reply mailbox. |
| Admin → operator deep-link | `MessageSquare` icon on every machine row + "Test chat" button on the detail header opens `/?account=…&machine=…` in a new tab. |
| Confirm dialog | Branded `<ConfirmProvider>` + `useConfirm()` hook replaces `window.confirm`. Esc/Enter/click-outside, danger flag. |
| Knowledge base for the test machine | Felder (test) — `machine_id 700a3579-8cdf-4afa-2bb8-08db9ef8e885`, account `8452d639-8953-46ea-a57a-08db9ef8b057`. Document count drifts as we test reprocess flows; check `/admin/machines/<id>` for the live total. |

### What's NOT done yet

_Nothing critical pending — the launch list has been worked through.
Forward-looking items live in §5 below._

### Key git commits (most recent first)

```
???     Webhook escalation channel, per-machine escalations list, ingestion 5-min budget + watchdog
6bafa47 Phase 4 escalation, admin machine create/delete, onboarded-only login pickers
c357c3c QR sticker: download as PNG instead of browser print
2eb28ed Auto-promote feedback, fix scroll fade, add Phase 3 QR access
54613b8 Resolution prompt + clickable source links in chat
5487262 Iteration 3: progress bars, OCR threshold tune, reprocess + queue
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
| QR sticker preview + download view | [src/components/admin/QrPrintView.tsx](../src/components/admin/QrPrintView.tsx) |
| QR sticker PNG generator (canvas + qrcode lib) | [src/admin/qrSticker.ts](../src/admin/qrSticker.ts) |
| Escalation target admin route (account-scoped) | [src/app/api/admin/accounts/[accountId]/escalation/route.ts](../src/app/api/admin/accounts/%5BaccountId%5D/escalation/route.ts) |
| Escalation snapshot endpoint (operator) | [src/app/api/chat/escalate/route.ts](../src/app/api/chat/escalate/route.ts) |
| Escalation token-gated view (public) | [src/app/api/escalations/[token]/route.ts](../src/app/api/escalations/%5Btoken%5D/route.ts), [src/app/escalation/[token]/page.tsx](../src/app/escalation/%5Btoken%5D/page.tsx) |
| Escalation token + snapshot helpers | [src/lib/escalation.ts](../src/lib/escalation.ts) |
| Admin escalation target card | [src/components/admin/MachineEscalationCard.tsx](../src/components/admin/MachineEscalationCard.tsx) |
| Per-machine escalations list (API + page + component) | [src/app/api/admin/machines/[id]/escalations/route.ts](../src/app/api/admin/machines/%5Bid%5D/escalations/route.ts), [src/app/admin/machines/[id]/escalations/page.tsx](../src/app/admin/machines/%5Bid%5D/escalations/page.tsx), [src/components/admin/EscalationsList.tsx](../src/components/admin/EscalationsList.tsx) |
| Ingestion budget + watchdog (`withIngestBudget`, `cleanupStuckDocuments`) | [src/lib/ingestion.ts](../src/lib/ingestion.ts) |
| Add-machine dialog (account/machine combobox) | [src/components/admin/AddMachineDialog.tsx](../src/components/admin/AddMachineDialog.tsx) |
| Admin machine create / delete routes | [src/app/api/admin/machines/route.ts](../src/app/api/admin/machines/route.ts), [src/app/api/admin/machines/[id]/route.ts](../src/app/api/admin/machines/%5Bid%5D/route.ts) |
| Onboarded sets endpoint (public) + client helper | [src/app/api/registered/route.ts](../src/app/api/registered/route.ts), [src/auth/registeredApi.ts](../src/auth/registeredApi.ts) |
| Resend e-mail wrapper | [src/lib/email.ts](../src/lib/email.ts) |
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
| `20260510180000_phase4_escalation.sql` | New `escalation_targets(account_id PK, channel, target, label, ...)`. Adds `share_token` (unique), `share_token_created_at`, `expires_at`, `created_by`, `note` columns to `escalations`. Also adds `escalations_conversation_idx`. |
| `20260511100000_escalation_webhook_and_doc_updated_at.sql` | Extends both channel check constraints (`escalation_targets`, `escalations`) to include `'webhook'`. Adds `kb_documents.updated_at timestamptz not null default now()` + index — bumped on every status / progress write so the watchdog can detect stuck rows. |

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
RESEND_API_KEY=...
RESEND_FROM=Opti Assist <noreply@optipeople.dk>
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
    "resend_key":    { "ok": true, "detail": "Opti Assist <noreply@optipeople.dk>" },
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

## 5. Notes for the next session

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
