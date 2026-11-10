# Shared documents and duplicate-aware uploads: implementation plan

Written 2026-11-10. Revised 2026-11-10 after review (see §12 for what changed and why). Status: **revised proposal, awaiting approval**. Nothing here is implemented.

## 1. Why

Two pieces of customer feedback, same root problem: the same knowledge gets processed more than once.

1. **Partial duplicates.** At Korpusgaden, one long line is built from many machines. Kristian has files `KF1...` and `KF2...`, where some `KF2` files are the `KF1` file plus extra pages appended. Today each is fully OCR'd, table-repaired, captioned and embedded, which takes hours. They want: "This knowledge already exists in file X. Upload only what is missing?"
2. **Documents shared across machines.** The same manual applies to several machines. Today it must be uploaded and processed once per machine.

## 2. Goals and non-goals

Goals:

- A document belongs to the **account** and is **linked** to one or more machines.
- On upload, detect exact duplicates (whole-file hash) anywhere in the account and offer **"link instead of upload"**.
- **Zero regression for existing production users.** Every existing machine must answer exactly as before, until and after the switch.

Non-goals (this plan):

- **Partial overlap ("process only the new pages").** Moved to its own plan. The first design had too many failure modes and depends on facts about Kristian's files we do not have yet. See §10.
- Sharing across accounts. Matching is always scoped to one account. Never reveal that a file exists in another account.
- Sharing experience documents (`source_type = 'feedback'`). They stay machine-specific.
- Retiring the old `machine_id` columns. Optional, much later (Phase 6).

## 3. Production baseline (queried 2026-11-10)

| | Count |
|---|---|
| Accounts with machines | 18 |
| Machines (`machine_kb`) | 33, of which 13 have chunks |
| Documents (`kb_documents`) | 322 at first query |
| Chunks / assets | about 12,000 / 2,292 |
| Chunks per machine | 6,062, 3,356, 1,373, then 226 and below |
| Stored bytes | ~1.46 GB |
| Documents with `machine_id` null or orphaned | 0 |
| Chunks or assets whose `machine_id` differs from their document's | 0 |
| Machines with null `account_id` | 0 |
| Embedding model | `voyage-4-large` on all 33 machines and all chunks |
| PDFs by extraction | 116 text layer, 27 text layer + table repair, 71 OCR (no usable text layer) |
| Same title + same byte size, same account | 36 groups, **all on the same machine**, ~171 MB redundant |
| Titles present on more than one machine | 0 |

So nobody shares documents today (they can't), and the same-machine exact duplicate already happens 36 times. The whole-file hash check pays off immediately.

There is **one Supabase project**. Local dev, `npm run eval` and every script hit production. There is no staging database and no CI. Migrations are applied by hand with `npx supabase db push`, then the app is deployed.

## 4. Today's model and everything that depends on it

### 4.1 Schema facts that matter

- `kb_documents.machine_id` is `NOT NULL`, FK to `machine_kb` **ON DELETE CASCADE** (`supabase/migrations/20260506141924_initial.sql:23`). Deleting a machine deletes its documents, chunks and assets.
- `kb_chunks.machine_id` and `kb_assets.machine_id` are denormalized copies, `NOT NULL`, no FK. **Search filters on `kb_chunks.machine_id`**, not on the document (`20260918120000_search_v2.sql`, vector and keyword branches of `search_kb` and `search_kb_multi`).
- `kb_max_similarity` filters on `kb_chunks.machine_id` too, and has no `status='ready'` join (`20260813130000_kb_max_similarity.sql`).
- There is **no accounts table**. A document's account is only reachable via `kb_documents.machine_id -> machine_kb.account_id`.
- **A machine's account can change today.** `ensureMachineKb` (`src/lib/ingestion.ts:780-797`) upserts `{machine_id, account_id}`, so the CLI's `--account-id` silently moves a machine. Fixed in Phase 0.
- **No RLS policies and no storage policies exist.** All access goes through the service-role client; the app code is the whole security boundary.
- `kb_documents.status` has a CHECK constraint that was never altered (`initial.sql:30`). This plan avoids adding statuses.
- `kb_folders` is keyed `(machine_id, path)`; documents point at folders only by the `folder_path` string. There is no folder rename and no bulk `folder_path` update anywhere.
- `machine_kb.active_embedding_model` is per machine, and search filters chunks on it. A shared document is only searchable on machines whose model matches its chunks.
- No triggers, views, edge functions, pg_cron jobs or realtime subscriptions touch the KB tables. The only SQL functions that do are `search_kb`, `search_kb_multi` and `kb_max_similarity`.
- `doc.folder_machines` (`20260526120000_doc_initial.sql:55-78`) is a loose precedent for a link table with an account check. Its trigger only checks the folder's account; ours checks both sides.

### 4.2 Every code site that reads or writes by machine

Every row must be handled in the phase named.

| Area | Site | What it does today | Phase |
|---|---|---|---|
| Chat retrieval | `src/app/api/chat/route.ts` `search_kb` tool (RPC `search_kb_multi`) | filter by `kb_chunks.machine_id`, chips per machine | 3 |
| Chat prompt | `chat/route.ts` `buildSystemPrompt` | doc list `.eq("machine_id")`, inside the 1h prompt cache | 3 |
| Chat tools | `chat/route.ts` `list_documents` | `.in("machine_id").eq("operator_visible", true)` | 3 |
| Chat tools | `chat/route.ts` `get_page_image` | auth `allowed.includes(doc.machine_id)` | 3 |
| Chat tools | `chat/route.ts` `executeGetStoredImage` | reads asset by document, no machine check | 3 (verify) |
| Fleet | `src/lib/fleet.ts` `getFleetMachines` | doc count per machine | 3 |
| Fleet drawer | `src/components/KnowledgeDrawer.tsx:140-144` | groups by the single `machineId` on each document | 3 |
| Voice | `src/lib/searchKb.ts` `searchKb`, `listDocuments` | RPC `search_kb`, `.eq("machine_id")` | 3 |
| Voice | `src/app/api/voice/realtime/session/route.ts` `buildVoiceInstructions` | doc list `.eq("machine_id")` | 3 |
| Suggestions | `src/lib/suggestions.ts` `regenerateSuggestedQuestions`, `scripts/regenerate-suggestions.ts` | doc list by machine, RPC `kb_max_similarity` | 3 |
| Transcripts | `src/app/api/conversations/[id]/route.ts` `attachSources` | names chip machine from `kb_documents.machine_id` | 3 |
| Admin | `src/app/api/admin/machines/[id]/route.ts` GET | doc list + folders by machine | 3 |
| Admin | `src/app/api/admin/machines/route.ts` | doc count per machine (reads all accounts, filters in memory) | 3 |
| Admin | `src/app/api/admin/machines/[id]/folders/route.ts` | folder emptiness counts by machine | 4 |
| Admin | `src/lib/autoOrganize.ts` | reads and moves docs `.eq("machine_id")`, one row at a time | 4 |
| Admin | `src/app/api/admin/documents/[id]/url/route.ts` | behind `assertDocumentAccess` | 0, 3 |
| Operator | `src/app/api/machines/[id]/documents/route.ts` | `.eq("machine_id").eq("operator_visible", true)` | 3 |
| Operator | `src/app/api/accounts/[id]/documents/route.ts` | `.in("machine_id", fleetIds)` + machine name | 3 |
| Signed URLs | `src/app/api/documents/[id]/url/route.ts` | QR: `row.machine_id === qrMachineId`; bearer: account via machine | 3 |
| Signed URLs | `src/app/api/assets/[id]/url/route.ts` | same, on `kb_assets.machine_id` | 3 |
| Auth | `src/lib/auth.ts:369` `assertDocumentAccess` | embed `machine_kb!inner(account_id)` via the FK | **0**, 3 |
| Ingest sign/finalize | `src/app/api/admin/ingest/sign/route.ts`, `ingest/route.ts`, `ingest/image/route.ts`, `ingest/file/route.ts` | rebuild `${machineId}/${documentId}.ext` from the request | 4 |
| Ingest PDF | `src/lib/ingestion.ts` `insertPdfDocRow`, `ingestPdfFromStorage` (row-machine 403 check), `insertChunkRows`, `reprocessPdf`, `flipStuck`, `cleanupStuckDocuments`, sweep `resumeStale` | writes `machine_id` on doc and chunks | 1 (trigger), 4 |
| Ingest figures | `src/lib/imageIngestion.ts` `attachPdfFigures` | inserts `kb_assets` and caption chunks with `machine_id`, on every reprocess and resume | 4 |
| Ingest image/file | `src/lib/imageIngestion.ts`, `src/lib/fileIngestion.ts` (incl. `resumeQueuedFiles` / `retryFile` from the cron sweep) | same | 1 (trigger), 4 |
| Experience docs | `src/lib/feedback.ts` `publishExperienceDoc`, `src/lib/distill.ts` | insert doc + chunks with `machine_id` | 1 (trigger) |
| Experience doc deletes | `src/app/api/chat/feedback/route.ts:131`, `src/lib/distill.ts:240,405`, `src/app/api/admin/insights/[id]/route.ts:140`, `src/lib/feedback.ts:149,170` | delete `kb_documents` rows directly | none (safe while feedback docs cannot be shared; Phase 5 enforces that) |
| Delete doc | `src/app/api/admin/documents/[id]/route.ts` DELETE | removes storage object, sidecar, **then** row | 4 |
| Move doc | same route, PATCH; client helpers `src/admin/adminApi.ts:259-289` and `MachineDetail.tsx:1026,1122,2017` | `folder_path`, `operator_visible` by document id only, no machine in the call | 4 |
| **Delete machine** | `src/app/api/admin/machines/[id]/route.ts` DELETE | **removes storage objects under `${id}/`** (first 1,000 only), then relies on FK cascade | 4 (**blocker for sharing**) |
| CLI | `src/lib/ingestion.ts` `resetMachineKb`, `ensureMachineKb`, `scripts/ingest.ts` | delete all docs of a machine; upsert the machine | 0, 4 |
| Evals | `scripts/eval.ts` | 12 LLM chat cases over QR only | smoke test, not a gate |

## 5. Target model

```
machine_kb (machine_id, account_id, ...)            unchanged
kb_documents (id, account_id NEW, machine_id = "home machine", content_sha256 NEW, ...)
machine_documents NEW (machine_id, document_id, account_id, folder_path, operator_visible, created_at, created_by)
kb_chunks, kb_assets                                 unchanged (machine_id = the document's home machine)
```

Key decisions:

- **A document is visible on a machine if and only if a `machine_documents` row links them.** All reads go through the link.
- **Every document keeps a home machine, and the home machine is always one of its linked machines.** `kb_documents.machine_id` stays `NOT NULL`. `kb_chunks.machine_id` and `kb_assets.machine_id` keep following it. When the home link is removed while other links remain, the document is **rehomed** to another linked machine in the same transaction (§7 Phase 4). To the user all links are equal; "home" is internal.
  - Why not make the origin nullable (the first draft): reprocess, sweep resume, figure attach, the PATCH route and usage attribution all write or read the document's machine, and `kb_chunks.machine_id` / `kb_assets.machine_id` are NOT NULL. A null origin breaks all of them.
  - Why this is safer for search: the existing query (`c.machine_id = p_machine_id`) stays valid for a machine's home documents. Shared documents are an extra branch. Before anyone shares, the new search functions run the same query as the old ones (§7 Phase 1).
  - Why this is safer for rollback: the old read path keeps showing every document on a machine that is really linked to it.
- **Folder and operator visibility live on the link** (`machine_documents.folder_path`, `machine_documents.operator_visible`). A shared manual can sit in "Electrical" on machine A and in "Manuals" on machine B, and be operator-visible on one but not the other. The document's own `folder_path` / `operator_visible` columns always equal the **home link's** values, kept in sync by triggers in both directions until Phase 6. Title, summary, `meta`, file and chunks are on the document and shared.
- **Storage paths do not change.** New uploads keep `${machineId}/${documentId}.ext`. The path is just an address and stays put when a document is rehomed. Code must read `kb_documents.storage_path` and never rebuild the path from a machine id once the row exists.
- **All structural changes go through SQL functions** (link, unlink, delete machine), each one transaction with a row lock. supabase-js cannot run a transaction, and these must be atomic.
- **A document can only be linked to machines whose `active_embedding_model` matches its chunks.** All 33 match today.
- Matching for duplicates is **always scoped to the caller's account.**

## 6. Safety principles (non-negotiable)

1. **Expand, then switch, never contract (in this project).** Phases 1 and 2 only add columns, tables, functions and triggers.
2. **Rehearse on a copy first.** Every migration and every parity script runs against a restored copy of production before it runs on production (Phase 0). **Anything that can delete or rewrite existing data is a hard gate: it does not run on production until its rehearsal checklist has passed on the copy (§8.5).** In this plan that is all of Phase 4 and, if it ever happens, Phase 6. No rehearsal copy means no Phase 4.
3. **The database guarantees the link exists.** An `AFTER INSERT` trigger on `kb_documents` creates the home link. Every insert path is covered without touching that code. The backfill runs after the trigger is created, so in-flight ingests during the migration are covered either way.
4. **Reads switch behind a database flag, with rollback in under a minute and no deploy.** New SQL functions live beside the old ones; the old ones are never modified.
5. **The old read path stays correct until Phase 6.** Both sides are kept in sync (home machine, folder, visibility), so turning the flag off never shows stale folders or re-exposes a document an admin hid from operators.
6. **Prove parity before switching.** Set equality and search result equality, on all production data, must be exact (§8).
7. **Sharing is enabled only after delete semantics are fixed.** Phase 4 must be live, including the FK change, before Phase 5.
8. **Database row first, storage second.** Deletes remove rows in a transaction and only then remove storage objects. A crash leaves an unreferenced file (harmless, swept later), never a row without its file.
9. **Fail open on detection.** If hash checks fail or time out, the upload proceeds exactly as today.

## 7. Phases

### Phase 0: groundwork (small code fixes, no schema change)

Environment:

- **Create a rehearsal database** (done by the implementing agent, see D1): a second Supabase project restored from a production backup, including the `kb-documents` and `kb-images` buckets, since the delete rehearsal checks files. A Supabase branch alone starts without data, so it is not enough. It has a monthly cost while it exists; the agent confirms the cost with Morten before creating it. Point a local, git-ignored `.env.rehearsal` at it. All later "rehearse" steps mean this copy.
- Confirm point-in-time recovery is enabled on production; otherwise take a manual backup before each migration.
- Record baseline: counts in §3 and a search snapshot (§8.3) for every machine.

Code fixes, shipped and verified before migration A:

- **Pin the FK in `assertDocumentAccess`** (`src/lib/auth.ts:369`): `machine_kb!kb_documents_machine_id_fkey!inner(account_id)`. Reason: `machine_documents` has FKs to both `kb_documents` and `machine_kb` inside its primary key, which the Supabase API treats as a many-to-many path. The unpinned embed would then be ambiguous and fail, breaking admin PATCH, DELETE, reprocess and the admin document URL from Phase 1 on. First step of the rehearsal is to reproduce this failure on the copy with the old code, then confirm the pinned embed works.
- **`ensureMachineKb` must not overwrite `account_id`**: insert if missing, and throw if the machine exists under a different account.
- **Image finalize retry** (`imageIngestion.ts:141-203`): a retried finalize hits a duplicate key and `markFailedOnError` flips the existing, possibly ready, row to `failed`. Detect the existing row first and return done. Same check for file finalize (`fileIngestion.ts:101-115`), which returns a 500 today. Not caused by this plan, but shared documents raise the cost of that bug.

### Phase 1: additive schema (migration A, no behavior change)

`supabase/migrations/<ts>_shared_documents_expand.sql`:

```sql
set lock_timeout = '5s';   -- fail fast instead of queueing chat reads behind a blocked ALTER; retry if it trips

-- 1. account on documents
alter table kb_documents add column account_id text;
update kb_documents d set account_id = m.account_id
  from machine_kb m where m.machine_id = d.machine_id and d.account_id is null;

create or replace function kb_documents_fill_account() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.account_id is null then
    select account_id into new.account_id from machine_kb where machine_id = new.machine_id;
  end if;
  return new;
end $$;
create trigger kb_documents_fill_account before insert on kb_documents
  for each row execute function kb_documents_fill_account();

alter table kb_documents alter column account_id set not null;   -- safe: backfilled + trigger
create index kb_documents_account_idx on kb_documents (account_id);

-- 2. link table
create table machine_documents (
  machine_id       text not null references machine_kb(machine_id) on delete cascade,
  document_id      uuid not null references kb_documents(id) on delete cascade,
  account_id       text not null,
  folder_path      text,
  operator_visible boolean not null default false,
  created_at       timestamptz not null default now(),
  created_by       text,
  primary key (machine_id, document_id)
);
create index machine_documents_document_idx on machine_documents (document_id);
create index machine_documents_folder_idx on machine_documents (machine_id, folder_path);
alter table machine_documents enable row level security;   -- no policies, same as every kb table

-- account-match guard: a link may only join a machine and a document of the same account
create or replace function machine_documents_assert_account() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.account_id is distinct from (select account_id from machine_kb where machine_id = new.machine_id)
     or new.account_id is distinct from (select account_id from kb_documents where id = new.document_id) then
    raise exception 'machine_documents: account mismatch';
  end if;
  return new;
end $$;
create trigger machine_documents_assert_account before insert or update on machine_documents
  for each row execute function machine_documents_assert_account();

-- 3. every new document gets its home link automatically
create or replace function kb_documents_link_home() returns trigger
language plpgsql set search_path = public as $$
begin
  insert into machine_documents (machine_id, document_id, account_id, folder_path, operator_visible, created_by)
  values (new.machine_id, new.id, new.account_id, new.folder_path, new.operator_visible, new.created_by)
  on conflict do nothing;
  return new;
end $$;
create trigger kb_documents_link_home after insert on kb_documents
  for each row execute function kb_documents_link_home();

-- 4. mirror document -> home link (old code writes folder_path / operator_visible on the document)
create or replace function kb_documents_mirror_link() returns trigger
language plpgsql set search_path = public as $$
begin
  update machine_documents
     set folder_path = new.folder_path, operator_visible = new.operator_visible
   where machine_id = new.machine_id and document_id = new.id
     and (folder_path, operator_visible) is distinct from (new.folder_path, new.operator_visible);
  return new;
end $$;
create trigger kb_documents_mirror_link after update of folder_path, operator_visible on kb_documents
  for each row execute function kb_documents_mirror_link();

-- 5. backfill links (after triggers exist, so racing inserts are covered)
insert into machine_documents (machine_id, document_id, account_id, folder_path, operator_visible, created_by, created_at)
select machine_id, id, account_id, folder_path, operator_visible, created_by, created_at from kb_documents
on conflict do nothing;

-- 6. hash column (filled in Phase 2)
alter table kb_documents add column content_sha256 text;
create index kb_documents_account_sha_idx on kb_documents (account_id, content_sha256)
  where content_sha256 is not null;

-- 7. read flag (used from Phase 3)
alter table account_flags add column kb_links_read boolean;          -- null = follow the default
create table kb_settings (id boolean primary key default true check (id), links_read_default boolean not null default false);
insert into kb_settings default values;
alter table kb_settings enable row level security;
```

The insert paths keep writing `folder_path` on the document, as today. The home-link trigger copies it. That column is not "unused".

**New search functions.** Separate functions; the old `search_kb`, `search_kb_multi`, `kb_max_similarity` are not touched.

Measured on production during review: the old filter uses the approximate vector index for the largest machine (6,062 chunks, under 1 ms). Replacing the filter with a join through the link table turned that into an exact scan: 47 ms warm, **3 to 5.7 s cold**, and different results. So the filter is **not** replaced. Each candidate branch gets a second source instead:

- `search_kb_linked(p_machine_id, ...)`:
  - **Home branch:** the existing `vector_hits` and `keyword_hits` queries with the same filter (`c.machine_id = p_machine_id`) and one extra condition on the document row they already join: `d.machine_id = c.machine_id`. The home invariant guarantees these documents are linked.
  - **Linked-in branch:** the same two queries over chunks of documents linked to `p_machine_id` whose chunks carry another machine's id (`join machine_documents md ... where md.machine_id = p_machine_id and c.machine_id <> p_machine_id`), each limited to `p_candidates`.
  - Those two conditions make search safe while a rehome is half done (Phase 4, batched fallback): chunks not yet moved are invisible on the old home and still found on every linked machine, with no gaps and no duplicates.
  - Candidates = the best `p_candidates` of both branches together, ranked once. Everything after that (fusion, per-document cap, asset cap, final limit, return type) is the existing code. Same `hnsw.ef_search` and `iterative_scan` settings (re-apply the DO block from `search_v2.sql:299-320`).
  - Until a document is shared, the linked-in branch is empty and the function returns exactly what `search_kb` returns.
- `search_kb_multi_linked(p_machine_ids, ...)`: home branch `c.machine_id = any(p_machine_ids)` unchanged; linked-in branch covers documents linked to any requested machine whose home is **not** in the requested set. A chunk therefore appears once by construction. Linked-in chunks are attributed to `min(md.machine_id)` among the requested machines for the existing `machine_id` column and the per-machine quota. Add a `machine_ids text[]` column listing every requested machine the document is linked to (new return type).
- `kb_max_similarity_linked`: `greatest` of the existing query and the same query over linked-in documents. Keep the current semantics exactly (no `status='ready'` join).

The linked-in branch is an exact scan over the shared documents' chunks. Its cost only appears once sharing exists. Measure it on the rehearsal copy by linking the largest document (about 1,900 chunks) to a second machine: warm and cold. **Budget: warm within 50 ms of today, cold under 500 ms.** If it misses the budget, stop and redesign before Phase 5 (options: prewarm, a per-machine cap, or copying chunks for shared documents). Phases 1 to 4 are not affected by that outcome.

Rollback: `drop` the new functions, triggers, tables and columns. Old code never noticed them.

Verification: rehearse on the copy first, including the admin document routes (Phase 0 embed fix). Then on production, §8.1 and §8.2 must return zero rows right after the migration.

### Phase 2: file hashes (low risk)

- **Write path:** compute SHA-256 of the downloaded bytes where finalize already holds them and store it in `kb_documents.content_sha256`:
  - PDF: `ingestPdfFromStorage` right after the download, passed into `insertPdfDocRow`.
  - Image: `ingestImageFromStorage` (`fileBuffer`), into the insert in `runImagePipeline`.
  - File: `ingestFileFromStorage` (`fileBuffer`), into its insert.
  - CLI `ingestPdf` has the buffer up front.
  - Stored files never change after upload (the signed PUT uses `x-upsert: false`, reprocess does not replace the file), so the hash stays valid.
- **Backfill:** `scripts/backfill-content-hash.ts`, run **after** the write-path deploy is live (rows inserted by old code mid-deploy have no hash). For each document with `storage_path` and null hash: download, hash, update. Idempotent, resumable, batched, run locally. ~1.46 GB total.
- Verify: count of documents with null hash is 0, **excluding** `source_type = 'feedback'` (no file) and `status = 'failed'` (rejected uploads keep `storage_path` but their file is deleted). Spot-check that the 36 known duplicate groups now share a hash.

### Phase 2b: same-machine duplicate check (first user-visible value, needs only Phase 2)

"This file already exists on this machine. Skip it?" It needs hashes and nothing else: no links, no read switch, no delete changes. It would have caught all 36 duplicate groups in production. Ship it as soon as the Phase 2 backfill is verified.

- **Check endpoint** `POST /api/admin/ingest/check` `{ machineId, files: [{ name, size, sha256 }] }`. Auth: `assertMachineAccess`. Looks up `content_sha256` among **this machine's** documents (`kb_documents.machine_id = machineId`), excluding `failed` and `feedback`. Returns per file `none` or `on_this_machine { documentId, title }`. Phase 5 widens the lookup to the account and adds a third result.
- **Client hashing:** in `UploadCard` handlers (`MachineDetail.tsx`), hash with `crypto.subtle.digest('SHA-256', await file.arrayBuffer())` before `enqueueUploads`. Max file is 100 MB (bucket limit), acceptable in memory. Show a "Checking files..." state. Also compare hashes **within the drop**, so two identical files in one batch are caught.
- **UI:** the queue already flags same-title duplicates (`uploadQueue.tsx:83-85`, `363-364`). Feed that existing flag from the hash result, so this phase adds no new component. If the existing flag does not offer a skip, get a design reference before adding one (CLAUDE.md).
- **Fail open:** if hashing or the check fails or times out, enqueue exactly as today.
- No flag needed: nothing is blocked, the user can always upload anyway.

### Phase 3: switch reads behind a flag

Flag: `account_flags.kb_links_read` (null means follow `kb_settings.links_read_default`). Resolved by one helper `linkedReadsEnabled(accountId)` in a new `src/lib/kbLinks.ts` (not `use...`: the React hooks lint rule would flag that name in server code), cached in process for 30 seconds. Rollback is one SQL update and takes effect within 30 seconds, with no deploy. (An env var would need a redeploy on Vercel.)

`kbLinks.ts` also holds the shared query helpers so call sites don't each re-implement the link join:

- `linkedDocumentIds(machineIds)`, `documentsForMachine(machineId, filters)`, `machinesForDocument(documentId)`, `isDocumentOnMachine(documentId, machineId)`, `documentAccountId(documentId)`.

Change every Phase 3 row in §4.2:

- **Search:** RPC name chosen by the flag (`search_kb` vs `search_kb_linked`, etc.). Chips: when `machine_ids` has more than one entry, label with all machine names (fleet only).
- **Doc lists** (chat prompt, voice prompt, `list_documents`, operator routes, admin machine GET, suggestions): query through `machine_documents`, taking `folder_path` and `operator_visible` from the link. **Keep the exact same ordering, fields and filters**, so the chat system prompt stays byte-identical and the 1h prompt cache is not invalidated by the switch. That includes today's quirk that the voice lists do not filter `operator_visible` (§9.11): preserve it here, fix it separately.
- **Fleet lists** (`accounts/[id]/documents` and `KnowledgeDrawer.tsx`): return **one row per link**, so a shared document shows under each machine it is on. The drawer's grouping keeps working unchanged. Only search dedupes.
- **Counts** (`getFleetMachines`, admin machines list): count links. Also fix the admin machines list to scope to the caller's accounts while there.
- **Auth:**
  - `assertDocumentAccess`: check `kb_documents.account_id` directly, no FK embed.
  - Document and asset signed-URL routes: QR session allowed if `isDocumentOnMachine(doc, qrMachineId)`; bearer allowed if the document's `account_id` matches. Assets resolve through `kb_assets.document_id`.
  - `get_page_image`: allowed if the document is linked to any machine in `allowedMachineIds`.
  - `ingestPdfFromStorage` row check: unchanged in this phase.
- **Transcripts** (`attachSources`): name machines from links intersected with the conversation's machines.

Rollout: rehearse on the copy; then our own account on production; then the default for all. Before each step run §8 parity. Rollback: set the flag off.

Exit criteria: default on for at least one week, §8 parity green, no access errors in logs.

### Phase 4: switch writes and fix delete semantics (must ship before Phase 5)

Three steps, in this order. Do not combine them into one deploy.

**This is the only phase that deletes or rewrites existing data. Each step runs on production only after the destructive rehearsal in §8.5 has passed on the copy, with the result written down.**

**Step 1, migration B1 (additive): SQL functions and the reverse mirror.**

- Reverse mirror trigger on `machine_documents` (`after update of folder_path, operator_visible`): copy to `kb_documents` when the link is the home link, guarded with `is distinct from` so the two mirrors cannot loop. From here the document's columns equal the home link no matter which side is written.
- `kb_unlink_document(p_machine_id, p_document_id)`:
  1. Lock the document row (`for update`).
  2. Delete the link.
  3. If no links remain: delete the document row (cascades chunks and assets) and return its storage paths (object and sidecar).
  4. Else if the removed link was the home: **rehome**. Pick the oldest remaining link; set `kb_documents.machine_id`, `folder_path`, `operator_visible` from it; update `kb_chunks.machine_id` and `kb_assets.machine_id` for the document.
- `kb_link_document(p_machine_id, p_document_id, p_folder_path, p_created_by)`: lock the document row, then insert the link. Rejects: document not found (deleted meanwhile), different account, `source_type = 'feedback'`, embedding model mismatch between the machine and the document's chunks. Idempotent.
- `kb_delete_machine(p_machine_id)`: runs the unlink logic for every linked document, deletes the machine row, returns all storage paths of fully deleted documents. One transaction.
- `kb_delete_document(p_document_id)`: delete everywhere. Lock, delete the row, return storage paths.

**Rehoming and large deletes are the most likely things to hit the statement timeout.** Rehoming rewrites every chunk row of the document, and each rewrite re-inserts into the vector index (about 1,900 rows for the largest document). A machine delete cascades thousands of chunks. Chunk inserts already had to be split into smaller slices for this reason (`eee50c9`). Measure both on the copy with the largest document and the largest machine.

Rule: the single-transaction version ships only if the worst case finishes in **under half the statement timeout**. Otherwise use the batched versions below. They are specified now so the fallback is not designed under pressure.

- **Batched rehome.**
  1. One short transaction: lock the document, delete the link, set `kb_documents.machine_id`, `folder_path`, `operator_visible` from the new home link. The document row is now correct.
  2. `kb_finish_rehome(p_document_id, p_batch)`: move up to `p_batch` (start with 200) chunk and asset rows whose `machine_id` differs from the document's, return how many are left. The app calls it until it returns 0.
  3. Idempotent and resumable. If the request dies, the cron sweep finds documents with `kb_chunks.machine_id <> kb_documents.machine_id` (the §8.1 invariant) and finishes them.
  4. Linked search stays correct throughout (see the two conditions in Phase 1). With the flag off, the old search would still show the unmoved chunks on the old home until the batches finish; that window is minutes and only matters during an emergency rollback.
- **Batched machine delete.** Unlink the machine's documents one at a time, each in its own transaction (`kb_unlink_document`), removing files after each. Delete the machine row last, when it has no documents left. A crash leaves a machine with fewer documents, and the delete can simply be run again.

**Step 2, code deploy.**

- **Delete document becomes "remove from this machine".** New route `DELETE /api/admin/machines/[id]/documents/[docId]`: fence in-flight ingest as today, call `kb_unlink_document`, then remove any returned storage paths, then regenerate suggestions for that machine. The old `DELETE /api/admin/documents/[id]` becomes "delete everywhere" via `kb_delete_document` (regenerate suggestions for every machine that was linked). `MachineDetail.tsx` single and bulk delete call the new route.
- **Delete machine:** replace the `${id}/` prefix sweep with `kb_delete_machine`, then remove the returned storage paths. Shared documents survive and are rehomed. This also removes the 1,000-object limit of today's sweep.
- **`resetMachineKb` (CLI):** unlink every document of the machine through the same function. Today it leaves sidecars behind; the returned paths include them.
- **Folders and visibility:** new route `PATCH /api/admin/machines/[id]/documents/[docId]` for `folderPath` and `operatorVisible`, writing the link (with `ensureFolderPath` for that machine). The client helpers in `adminApi.ts:259-289` and their callers gain a machine id. The old `PATCH /api/admin/documents/[id]` keeps document-level fields only (title). Auto-organize and the folder emptiness check read and write `machine_documents` for the machine in context.
- **Ingest:**
  - Sign and finalize routes, sweep and reprocess use `kb_documents.storage_path` once the row exists; they never rebuild the path from a machine id.
  - The finalize row check (`ingestion.ts:1520`) and the PATCH/reprocess guards accept any machine the document is linked to (`isDocumentOnMachine`), not only the home.
  - Pipeline writes (`insertChunkRows`, `attachPdfFigures`, `retryFile`) keep using the document's current home `machine_id`, read from the row at write time.
- **Document changes reach every machine:** when an ingest or reprocess finishes, suggestions are regenerated for the home machine inside the pipeline as today, and for the other linked machines **after** the response (not inside the ingest time budget, where a slow regeneration would report a timeout for a document that succeeded). Title edits regenerate nothing today; keep that.

**Step 3, migration B2, after step 2 is live and verified.**

```sql
set lock_timeout = '5s';
alter table kb_documents drop constraint kb_documents_machine_id_fkey;
alter table kb_documents add constraint kb_documents_machine_id_fkey
  foreign key (machine_id) references machine_kb(machine_id);   -- NO ACTION, was CASCADE
```

From here a machine row cannot be deleted while it is still the home of any document, so no code path can destroy documents by deleting a machine directly. `kb_delete_machine` unlinks or rehomes first, so it is unaffected. The constraint name stays the same, so the pinned embed from Phase 0 keeps working.

Why B2 comes last: the old machine DELETE removes storage objects first and then the row. With NO ACTION and old code still running, the row delete would fail **after** the files were gone.

Both mirror triggers stay until Phase 6.

Rollback: flag off restores reads, and they stay correct because both sides are in sync. Step 2 can be rolled back to the previous deployment as long as B2 has not been applied. B1 is additive.

### Phase 5: link instead of upload

Gate: `account_flags.shared_documents boolean default false` (new column; `src/lib/accountFlags.ts` needs it in `COLUMNS`, `toFlags` and the patch type). Only for accounts with linked reads on. **Precondition:** the linked-in search branch met its latency budget on the rehearsal copy (Phase 1).

- **Check endpoint** (from Phase 2b): for accounts with `shared_documents` on, widen the lookup from this machine to the machine's **account** (via `machine_documents`), and add a third result:
  - `none`
  - `on_this_machine { documentId, title }`
  - `on_other_machines { documentId, title, machines: [{ id, name }] }`
- **Client hashing** is already in place from Phase 2b.
- **Batch dialog** when any file matched (one dialog per drop, not per file), with per-file choices preselected:
  - matched on another machine: **Link** (default) / Upload anyway / Skip
  - matched on this machine: **Skip** (default) / Upload anyway
  - buttons: "Apply", "Upload all anyway"
  - Built on the existing `AutoOrganizeDialog` pattern (`useFocusTrap`, `dialog-overlay`/`dialog-panel`, `Checkbox`, `Button`). **Needs a design reference before building** (CLAUDE.md; open decision D5).
- **Link endpoint** `POST /api/admin/machines/[id]/documents/link` `{ documentId, folderPath }`: `assertMachineAccess`, `ensureFolderPath`, `kb_link_document` (which enforces account, source type and embedding model), regenerate suggestions for this machine. Idempotent.
- **"Shared with N machines" tag** in the machine document list (existing `Tag` component), with the machine names in a tooltip. Delete on a shared document asks "Remove from this machine" vs "Delete from all N machines" (`useConfirm` covers the two-way case; a three-way needs the dialog pattern).
- The server hash computed at finalize (Phase 2) is authoritative. A wrong client hash can only cause a missed match or a link offer to a document in the same account, never a cross-account leak, because the check is account-scoped.

### Phase 6: tidy up (optional, months later)

Drop the mirror triggers and the document-level `folder_path` / `operator_visible`, drop the old search functions, drop the flag. Only after Phase 5 has run without incident for a long time. Not required.

## 8. Verification

Run everything on the rehearsal copy first, then on production.

### 8.1 Invariants (must be zero rows; after Phase 1 and before every rollout step, and worth a daily check once sharing is on)

```sql
-- every document has its home link
select d.id from kb_documents d
left join machine_documents md on md.document_id = d.id and md.machine_id = d.machine_id
where md.document_id is null;

-- no document without links
select d.id from kb_documents d
where not exists (select 1 from machine_documents md where md.document_id = d.id);

-- no link crosses accounts, and document account matches its home machine
select md.document_id from machine_documents md
join kb_documents d on d.id = md.document_id
join machine_kb m on m.machine_id = md.machine_id
where md.account_id <> d.account_id or md.account_id <> m.account_id;

-- chunks and assets follow the document's home
select c.id from kb_chunks c join kb_documents d on d.id = c.document_id where c.machine_id <> d.machine_id
union all
select a.id from kb_assets a join kb_documents d on d.id = a.document_id where a.machine_id <> d.machine_id;

-- document folder and visibility equal the home link's
select d.id from kb_documents d
join machine_documents md on md.document_id = d.id and md.machine_id = d.machine_id
where (d.folder_path, d.operator_visible) is distinct from (md.folder_path, md.operator_visible);
```

### 8.2 Set equality per machine (until Phase 5 is enabled for an account, must be zero rows)

```sql
(select machine_id, id from kb_documents
 except select machine_id, document_id from machine_documents)
union all
(select machine_id, document_id from machine_documents
 except select machine_id, id from kb_documents);
```

### 8.3 Search parity (script `scripts/verify-kb-links.ts`)

For every machine, for the eval questions plus 20 sample queries per machine (titles and summary phrases), call old and new functions with the same embedding and compare: identical `chunk_id` order and scores for `search_kb` vs `search_kb_linked`, same for `search_kb_multi` on each account's fleet, and identical `kb_max_similarity`. Because the home branch is the same query, identical is the right bar while nothing is shared. If a difference appears, compare both against an exact scan to tell a real difference from the vector index's approximation, and stop the rollout until it is explained.

Also record `explain analyze` timings for both, warm and cold. And once, on the copy: the shared-document latency test from Phase 1.

### 8.4 App-level checks

- `npm run lint`, `tsc --noEmit`.
- `npm run eval` as a **smoke test only**. It is 12 LLM chat cases over the QR path against production; it does not cover admin, voice, operator lists or fleet, and its answers vary. It is not a parity gate.
- The chat system prompt for each machine is byte-identical with the flag off and on (log a hash of the system block in a one-off script).
- Manual smoke per phase, on the rehearsal copy first: upload PDF/image/xlsx, ask with citations, open cited page, QR session view, operator document list, fleet chat and drawer, voice, move to folder, toggle visibility, reprocess, delete, delete machine. From Phase 4 also: delete a machine that is the home of a shared document, then reprocess that document from the other machine.

### 8.5 Destructive rehearsal (hard gate for Phase 4, and for Phase 6 if it happens)

Run on the rehearsal copy, refreshed from a recent production backup, with the exact migrations and the exact build that will go to production. Record the outcome of every line in the pull request. Any failure stops the phase.

Before each run, snapshot on the copy: row counts of `kb_documents`, `kb_chunks`, `kb_assets`, `machine_documents`, `kb_folders` per machine, and the list of storage objects in `kb-documents` and `kb-images`. After each action, diff against the snapshot. **Exactly the expected rows and files are gone, and nothing else.**

1. **Remove an unshared document from its machine.** Its row, chunks, assets, file and sidecar are gone. Every other document on the machine is untouched and still answers.
2. **Remove a shared document from a non-home machine.** Only the link is gone. The document, chunks and file are intact and it still answers on the other machines.
3. **Remove a shared document from its home machine.** The document is rehomed; chunks and assets follow; folder and visibility match the new home link; the file is intact; it still answers on the remaining machines and no longer on the old one.
4. **Delete everywhere** on a shared document. Gone on every machine; one file removed.
5. **Delete a machine with only unshared documents.** Same end state as today's delete: no rows, no files, no folders left for that machine.
6. **Delete the largest machine** (6,062 chunks) and **rehome the largest document** (about 1,900 chunks). Time both. Under half the statement timeout: single transaction is fine. Otherwise switch to the batched versions (Phase 4) and rerun this whole checklist with them, including killing a batched rehome halfway and confirming the sweep finishes it and search is correct in between.
7. **Delete a machine that is the home of shared documents.** Those documents survive, rehomed; then reprocess one of them from another machine and confirm it finishes.
8. **Delete a machine while one of its documents is mid-ingest.** No orphan row, no crash loop in the sweep.
9. **Link and unlink the same document at the same time** (two sessions, repeated). Never a document without links, never a link without a document.
10. **Kill the request between the database call and the storage removal.** Rows are gone, files remain, and the orphan script lists exactly those files.
11. **`resetMachineKb` from the CLI** on a machine with a shared document. The shared document survives.
12. **Migration B2 ordering.** With the old build still deployed on the copy, confirm that a machine delete after B2 would fail after removing files. This proves why B2 must come last, and that the production order is right.
13. After all of the above: every §8.1 invariant returns zero rows, and the search snapshot (§8.3) for every untouched machine is identical to before.

Then, on production, apply each step with the same build, run §8.1 immediately, and do the first real delete on our own test account before any customer does one.

## 9. Risks and edge cases

1. **Machine delete destroying shared files.** Today it sweeps the `${id}/` storage prefix. Fixed in Phase 4 by deleting only the files of documents that lost their last link.
2. **Crash in the middle of a delete.** Rows are removed in one transaction; storage is removed afterwards. A crash leaves unreferenced files only. A script lists objects in `kb-documents` / `kb-images` not referenced by any `kb_documents.storage_path`, sidecar, or `kb_assets.storage_path`, prints them, and deletes only with an explicit `--delete`. It also catches uploads that were signed and PUT but never finalized.
3. **Link racing with the last unlink.** Both lock the document row, so either the link lands first and the document survives, or the document is gone and the link fails with "not found".
4. **Rolling reads back after sharing exists.** The old functions see each document only on its home machine, so other linked machines lose it until the flag goes back on. Folders and visibility stay correct. Acceptable as an emergency measure; documented, not silent.
5. **Fleet duplicates.** Search returns a shared chunk once by construction. Fleet lists show one row per link on purpose.
6. **Prompt cache.** Any change in doc list order or format invalidates the 1h prompt cache and changes behavior. Parity check in §8.4.
7. **Concurrent ingest during migration.** Covered by trigger-before-backfill ordering and `lock_timeout`.
8. **Cross-account leak.** All matching is account-scoped in SQL; the link trigger rejects cross-account links; a machine can no longer change account (Phase 0).
9. **Different embedding models.** A document linked to a machine with another model would be silently unsearchable there. `kb_link_document` rejects it. Changing a machine's model later must re-check its linked-in documents.
10. **Shared-document search latency.** Unknown until measured (Phase 1). It gates Phase 5 only.
11. **Pre-existing gaps, out of scope, worth fixing separately:**
    - The voice routes do not check a bearer caller's machine against their account (`src/app/api/voice/realtime/tool/route.ts`, `session/route.ts`).
    - Voice `listDocuments` (`searchKb.ts:157-162`) and the voice prompt do not filter `operator_visible`; chat does.
    - `fleet.ts:19` says its count is "operator-visible" but does not filter on it.

## 10. Deferred: process only the new pages

Kristian's first request is **not** solved by this plan beyond exact duplicates. It gets its own plan, after Phases 1 to 5, and only once we have his real files.

What the review found in the first design (text-layer page hashes, a `skip_pages` column, a coverage table that makes KF2 depend on KF1):

- `on delete restrict` on the source document loses files (the delete route removes storage before the row) and can block machine deletes.
- The analyze step has no checkpoint inside the 300 s route limit; the 1,930-page PDF takes minutes. It would fail open on exactly the large files it is meant for.
- "Only new pages" with nothing new ends as a failed document (zero-chunk guard, `ingestion.ts:1048-1058`).
- The page hash is fragile across re-exported files: "Page X of Y" footers, revision dates, and different text-item splits all change it.
- 71 of 214 production PDFs are OCR'd with no usable text layer. Those are the slow ones, and the design cannot see overlap in them.
- No KF files are in production yet, so we do not know whether they are scanned or digital, or how KF2 is produced from KF1.
- A parked upload awaiting a decision lives only in browser memory; closing the tab leaves a file with no row.

Direction to evaluate first, because it removes most of those problems: **reuse extraction results per page instead of skipping pages.** When a page of KF2 matches a page already processed in the account, copy that page's extracted text (OCR, table repair) and figure captions into KF2's own extraction, then chunk and embed KF2 as a normal, complete document. KF2 stays self-contained: no dependency on KF1, no coverage table, no citation pointing at another file, nothing special on delete. The expensive steps are skipped; embedding is cheap. It needs a page fingerprint that also works for scanned pages (for example a hash of the page's content stream or a downscaled render).

Inputs needed before planning: Kristian's actual KF1/KF2 pairs, and timing of where the hours go on them (OCR, table repair, captions, embedding).

## 11. Open decisions for review

- **D1. Rehearsal database: decided 2026-11-10, required.** A second Supabase project restored from backup, for the length of the project. Has a cost. **The implementing agent creates it** as the first step of Phase 0, restores the latest production backup into it (database and both storage buckets), and refreshes it before the Phase 4 rehearsal. The agent shows Morten the monthly cost and gets a yes before creating it, since that is the one step that spends money. It holds customer documents, so it gets the same access restrictions as production, its keys stay out of the repo, and the agent deletes it (after confirming with Morten) when Phase 5 has shipped or the project stops.
- **D2. Who may "delete everywhere"?** Recommended: any admin of the account, with a confirm listing the machines.
- **D3. Rehome choice** when the home link is removed: oldest remaining link (recommended, deterministic).
- **D4. Same-machine exact duplicates** (36 today): offer a one-off cleanup tool, or leave them?
- **D5. Design references needed** (CLAUDE.md "never invent UI components"): the batch duplicate dialog, the "Shared with N machines" tag, and the remove/delete-everywhere confirm.
- **D6. Partial overlap** (§10): confirm it is deferred, and ask Kristian for sample files now so the follow-up plan can start from real data.

## 12. Review log (2026-11-10)

The first draft was checked against the code (two audits) and the production database. Its inventory and schema facts held. These changes came out of it:

| Finding | Change |
|---|---|
| `machine_documents` makes the `machine_kb` embed in `assertDocumentAccess` ambiguous, likely breaking admin document routes from Phase 1 | Pin the FK in Phase 0; reproduce on the copy |
| Replacing the search filter with a link join changed the query plan on the largest machine: exact scan, up to 5.7 s cold, different results. The "identical results" gate could not pass | Keep the existing filter as the home branch; shared documents are a second branch. Latency budget gates Phase 5 |
| One database for everything; evals are an LLM smoke test | Rehearsal copy (D1); evals demoted; parity script is the gate |
| After Phase 4, flag-off reads would use stale folder and visibility values, re-exposing hidden documents | Two-way mirror until Phase 6; database flag instead of env var; mirror trigger no longer dropped in Phase 4 |
| A nullable origin breaks reprocess, sweep resume, figure attach, PATCH and client resume | Home machine stays NOT NULL; rehome on unlink |
| Deletes were multi-step from app code: crash leaves invisible documents; link can race the last unlink | SQL functions with row locks; rows first, storage second; zero-link invariant check |
| Phase 6 design problems (§10) | Deferred to its own plan with a simpler direction |
| Second pass (plan author): the same-machine duplicate check waited behind Phase 4 for no reason; rehoming had no named fallback for statement timeouts; `useLinkedReads` would trip the hooks lint rule | Phase 2b ships the same-machine check right after hashes; batched rehome and batched machine delete specified, with a threshold; helper renamed `linkedReadsEnabled` |
| Smaller: machine can change account; embedding model per machine; feedback docs linkable; PATCH had no machine id; fleet drawer grouping; `lock_timeout`; failed rows in the hash check; suggestions inside the ingest budget; image finalize retry | Folded into Phases 0 to 5 |

## 13. Effort (rough)

| Phase | Size | Can ship alone |
|---|---|---|
| 0 Groundwork + rehearsal copy | 1 day | yes |
| 1 Expand schema + new search functions + latency test | 1.5 days | yes, no behavior change |
| 2 Hashes + backfill | 0.5 day | yes |
| 2b Same-machine duplicate check | 1 day | yes, first visible value |
| 3 Read switch + parity script | 2 to 3 days | yes, behind flag |
| 4 SQL functions, writes, delete semantics, FK change | 3 days | yes, in three steps |
| 5 Link instead of upload | 2 to 3 days + design | after 4 and the latency budget |

Apart from the duplicate hint in Phase 2b, Phases 0 to 4 change nothing the user can see. They are where the production risk lives, and each one is rehearsed on the copy, verified and reversible on its own.
