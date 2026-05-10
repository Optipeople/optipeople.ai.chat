# OptiAI — Current Status & Next Iteration

Living document. Reflects where the project is *right now* and the next chunk of
work to pick up. For long-term direction see [architecture.md](architecture.md);
for product framing see [overview.md](overview.md).

Last updated: 2026-05-10.

---

## 1. Where we are

Iteration 2 is shipped on `main`. On top of iteration 1's agentic
retrieval, super-admins can now manage manuals end-to-end through a
browser admin UI — no terminal required.

### What's live

| Layer | State |
|---|---|
| Hosting | Repo at [Optipeople/optipeople.ai.chat](https://github.com/Optipeople/optipeople.ai.chat). Vercel project linked, env vars set. |
| Frontend | Next.js 16 App Router. Operator login → account/machine pickers → chat (streaming). |
| Backend (Next route handlers) | `/api/chat` (agentic), `/api/health`, `/auth-api/[...path]` (Optipeople proxy). |
| Database | Supabase project `wnswhzitolcfbfulchra` in eu-central-1. Schema applied via two migrations: initial + `search_kb()`. RLS on; service role bypasses. |
| Storage | Supabase bucket `kb-documents` (private, 100 MB, PDF only). Felder PDFs uploaded under prefix `<machine_id>/`. |
| Embeddings | Voyage `voyage-4-large` @ 1024d (Matryoshka). Free tier (3 RPM / 10k TPM); helper retries on 429. |
| Auth | Optipeople OAuth2, dev proxy → real `/auth-api/[...]` route handler. |
| Knowledge base for the test machine | 6 documents, ~24 chunks ingested for `machine_id = 700a3579-8cdf-4afa-2bb8-08db9ef8e885` (Felder, account `8452d639-8953-46ea-a57a-08db9ef8b057`). |
| Admin UI | `/admin/machines` (list) + `/admin/machines/[id]` (detail with PDF upload, inline summary edit, machine-name edit, document delete). Gated server-side by `permissionName === "SuperAdministrator"` from Optipeople; client gate hides chrome for non-admins. |
| Ingestion API | `POST /api/admin/ingest` (multipart), `PATCH /api/admin/machines/[id]`, `PATCH/DELETE /api/admin/documents/[id]`, all gated by `requireSuperAdmin`. |

### What's NOT done yet

- No conversation persistence (`conversations` / `messages` tables exist in
  the schema but the chat route doesn't write to them yet).
- No QR access, escalation, or feedback loop.
- No production deploy verified through the browser yet (Vercel preview /
  prod URL hasn't been clicked through end-to-end since last env update).
- Admin UI can only manage **existing** `machine_kb` rows. Creating a
  brand-new machine still requires the CLI; the UI doesn't pull from
  Optipeople's machine list.
- Long uploads (>5min embedding) will fail at the Vercel function
  timeout — fine for typical manuals, will need async/queue if we hit it.

### Key git commits (most recent first)

```
1a860dc Iteration 1: agentic retrieval + Voyage ingestion pipeline
51326d6 Add /api/health readiness check
9a7be6f Strip content-encoding from auth-api proxy response
7b16e08 Migrate from Vite + Express to Next.js 16 (App Router)
2a2ddf5 Add architecture plan and Supabase scaffolding
```

### File map for the parts that matter most

| Concern | File |
|---|---|
| Operator chat (agentic loop, system prompt, search_kb tool) | [src/app/api/chat/route.ts](../src/app/api/chat/route.ts) |
| Hybrid search SQL function | [supabase/migrations/20260507141106_hybrid_search.sql](../supabase/migrations/20260507141106_hybrid_search.sql) |
| Per-machine ingestion CLI | [scripts/ingest.ts](../scripts/ingest.ts) |
| Voyage embedding helper | [src/lib/voyage.ts](../src/lib/voyage.ts) |
| Supabase server client | [src/lib/supabase.ts](../src/lib/supabase.ts) |
| Readiness probe | [src/app/api/health/route.ts](../src/app/api/health/route.ts) |
| Schema | [supabase/migrations/20260506141924_initial.sql](../supabase/migrations/20260506141924_initial.sql) |
| Optipeople auth proxy | [src/app/auth-api/[...path]/route.ts](../src/app/auth-api/%5B...path%5D/route.ts) |
| Auth state (client) | [src/auth/AuthContext.tsx](../src/auth/AuthContext.tsx) |

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
npx vercel env pull .env.local   # pulls Production-scoped vars by default
                                 # (use --environment=preview if you want preview)
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
→ Settings → Database → Reset password** (or use the existing one if you
have it).

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
2. Log in with `mpg@optipeople.dk` (or any Optipeople-staging account that
   has access to the test account).
3. Pick the **Felder (test)** machine — `id 700a3579-8cdf-4afa-2bb8-08db9ef8e885`.
4. Ask: *"Hvordan fjerner jeg alarm 731?"*
5. Expected: a streamed Danish answer with the full 10-step procedure
   citing **Alarm 731 solution**. Confirms agentic retrieval works.

### Useful test IDs (not secrets — these are visible in the auth API)

```
account_id = 8452d639-8953-46ea-a57a-08db9ef8b057   # the test Optipeople account
machine_id = 700a3579-8cdf-4afa-2bb8-08db9ef8e885   # Felder (test)
supabase project ref = wnswhzitolcfbfulchra
```

### Re-ingest manuals (e.g. after editing the chunker)

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

## 3. Iteration 2 — Admin UI (shipped)

**Goal (met):** a super-admin can add manuals to any existing machine
through the browser without touching a terminal. The CLI stays around
for power use, but the default path is now the UI.

### Why this is the right next slice

- Today only a developer can update a machine's KB. Iteration 2 unblocks
  Optipeople-internal staff to onboard new customers' manuals.
- Audit-trail work (iteration 3) is more useful once we have a UI to view
  it from. Doing UI plumbing once benefits both.

### Scope (in priority order)

1. **Lift ingestion into a reusable lib.** Right now `scripts/ingest.ts`
   has the pipeline inline. Extract it into `src/lib/ingestion.ts`:
   - Function: `ingestPdf({ machineId, accountId, machineName, fileName, fileBuffer, summary, createdBy }): Promise<{ documentId, chunkCount }>`
   - The CLI in `scripts/ingest.ts` becomes a thin loop that reads files
     from disk and calls this function.
   - The new HTTP endpoint (step 4) will call the same function.
   - **No behaviour changes** in this step — just a refactor.
2. **Super-admin gating.** Reuse the Optipeople role system instead of a
   parallel allowlist.
   - Server-side helper `requireSuperAdmin(req)` in `src/lib/auth.ts`:
     - Reads `Authorization: Bearer <token>` from the request.
     - Calls Optipeople `/api/User/GetCurrentUser` to resolve the caller.
     - 403 if `role.name !== "SuperAdmin"` (case-insensitive).
     - Caches results per-request only.
   - Used by every admin route handler. Belt-and-suspenders client side: hide
     `/admin` from `UserMenu` unless the user's role is SuperAdmin
     (needs the role surfaced through `AuthContext` — see step 3).
3. **List + detail pages (server components where possible):**
   - `app/admin/layout.tsx` — server component. Fetches the user via
     `requireSuperAdmin`. Renders a thin sidebar / header with "Admin —
     OptiAI" branding. Throws 403 page on failure.
   - `app/admin/machines/page.tsx` — server component. Lists
     `machine_kb` rows joined with a count of `kb_documents` (status='ready').
     Search box for name/id. Each row links to detail.
   - `app/admin/machines/[id]/page.tsx` — server component for the data,
     client component for the upload form / mutations. Shows:
     - Machine display name + ID + account ID (editable display name).
     - Document table: title, summary (editable inline), status, page
       count, byte size, created date, **Delete** button.
     - **Upload** zone (drag-drop or click-to-select PDF) with title and
       summary fields. POSTs to `/api/admin/ingest` and shows progress
       (status transitions: uploaded → extracting → embedding → ready).
4. **Admin route handlers** (all gated by `requireSuperAdmin`):
   - `POST /api/admin/ingest` — multipart form with `machineId`,
     `accountId`, `machineName`, `summary`, and the PDF file. Reads file
     into a buffer, calls `ingestPdf` from step 1.
   - `GET /api/admin/machines` — returns machine list with doc counts
     (used by the list page if it's a client component; server component
     can call Supabase directly instead — pick one).
   - `DELETE /api/admin/documents/[id]` — removes a `kb_documents` row
     (cascade kills the chunks) and deletes the Storage object.
   - `PATCH /api/admin/documents/[id]` — updates `summary` or `title`.
5. **One UX nicety**: when an upload finishes, the document row appears
   in the table without a page reload (use `router.refresh()` or
   optimistic update — keep it simple).

### Out of scope for iteration 2

- Bulk uploads, folder uploads, ZIP support — single PDF at a time is enough.
- Editable per-machine `system_prompt_extra` — admin field on the schema,
  but we don't need a UI for it yet.
- Audit / conversation viewing (that's iteration 3).
- Reordering documents, tagging, categorization.
- Re-embedding existing chunks with a different model. The schema already
  supports it via `embedding_model` per-row + `machine_kb.active_embedding_model`,
  but no UI to trigger it.

### Open decisions before starting

- **Admin UI design.** Stick with the same shadcn-style components and
  brand tokens — header in `--color-brand`, surfaces in `--color-surface`.
  No need for a fresh design system for an internal tool.

### Resolved

- **How to learn who the user is.** Lookup via Optipeople
  `/api/User/GetCurrentUser` — confirmed in the swagger as the canonical
  current-user endpoint, returns the full User shape (id, email, role).
  One round trip per admin request, fine for an internal tool.
- **What gates super-admin access.** `role.name === "SuperAdmin"` from
  the GetCurrentUser response. Avoids maintaining a parallel email
  allowlist and stays in sync with how Optipeople already manages staff.
- **Where `requireSuperAdmin` lives.** `src/lib/auth.ts`.

### Suggested commit cadence

1. *Refactor: extract ingestion into src/lib/ingestion.ts* (no behaviour change)
2. *Add requireSuperAdmin gate + SUPER_ADMIN_EMAILS env*
3. *Add /admin layout + machines list page*
4. *Add /admin/machines/[id] detail with document table*
5. *Add /api/admin/ingest endpoint and wire upload form*
6. *Add /api/admin/documents/[id] delete + summary edit*

Roughly half a day each, six commits, each individually deployable.

### Done when

A super-admin can:

- Visit `<vercel-url>/admin/machines` and see all known machines.
- Click into one, drag a PDF in, give it a summary, watch it transition
  through statuses to "ready", and see chunk count update.
- Edit a document's summary inline.
- Delete a document and watch its chunks (and Storage object) disappear.
- Then in a separate browser session as an operator: log in, pick the
  same machine, ask a question that requires the new manual, and see the
  AI cite it.

---

## 4. Iteration 3 (preview, not started)

After iteration 2:

- Persist `conversations` and `messages` rows during chat (write inside
  the agentic loop).
- `/admin/machines/[id]/conversations` — read-only audit list.
- Per-conversation drilldown showing tool calls and which chunks were
  retrieved (we already log `tool_chunks` in the schema).
- Resolution prompt at the end of a conversation ("Did this solve it?").
- Promote a "yes + solution text" to a new `kb_documents` row of
  `source_type = 'feedback'` — closes the loop.

See [architecture.md §7](architecture.md) for the full phase plan.

---

## 5. Things to do before any of this

- **Rotate every secret that touched chat** (Anthropic, Voyage, Supabase
  service role + DB password, Optipeople test creds). Free / staging
  creds, low blast radius, but cleaner before the first real customer.
- **Click through the production Vercel deploy end-to-end.** We've only
  verified locally since the last env-var update. Hit `<prod-url>/api/health`
  and run the same Felder alarm 731 test.
- **Confirm the Turbopack catch-all crash isn't a real bug.** Has happened
  twice in dev mode (cleared by stopping the server, deleting `.next`,
  restarting). Production build is unaffected. If it recurs frequently,
  consider rewriting the `/auth-api/[...path]` proxy as `middleware.ts`.
