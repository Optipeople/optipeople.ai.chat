# Shared documents and duplicate-aware uploads: implementation plan

Written 2026-11-10. Status: **proposal, awaiting review**. Nothing here is implemented.

## 1. Why

Two pieces of customer feedback, same root problem: the same knowledge gets processed more than once.

1. **Partial duplicates.** At Korpusgaden, one long line is built from many machines. Kristian has files `KF1...` and `KF2...`, where some `KF2` files are the `KF1` file plus extra pages appended. Today each is fully OCR'd, table-repaired, captioned and embedded, which takes hours. They want: "This knowledge already exists in file X. Upload only what is missing?"
2. **Documents shared across machines.** The same manual applies to several machines. Today it must be uploaded and processed once per machine.

## 2. Goals and non-goals

Goals:

- A document belongs to the **account** and is **linked** to one or more machines.
- On upload, detect exact duplicates (whole-file hash) anywhere in the account and offer **"link instead of upload"**.
- On PDF upload, detect page-level overlap with existing documents and offer **"process only the new pages"**.
- **Zero regression for existing production users.** Every existing machine must answer exactly as before, until and after the switch.

Non-goals (v1):

- Sharing across accounts. Matching is always scoped to one account. Never reveal that a file exists in another account.
- Detecting overlap on scanned pages (no text layer). See §9.6.
- Sharing experience documents (`source_type = 'feedback'`). They stay machine-specific.
- Retiring the old `machine_id` columns. Optional, much later (Phase 7).

## 3. Production baseline (queried 2026-11-10)

| | Count |
|---|---|
| Accounts with machines | 18 |
| Machines (`machine_kb`) | 33 |
| Documents (`kb_documents`) | 322 (215 pdf ready, 57 image, 25 file, 7 feedback, 18 in progress at query time) |
| Chunks / assets | 11,361 / 2,292 |
| Stored bytes | ~1.46 GB |
| Documents with `machine_id` null or orphaned | 0 |
| Same title + same byte size, same account | 36 groups, **all on the same machine**, ~171 MB redundant |
| Titles present on more than one machine | 0 |

So nobody shares documents today (they can't), and the same-machine exact duplicate already happens 36 times. The whole-file hash check pays off immediately.

## 4. Today's model and everything that depends on it

### 4.1 Schema facts that matter

- `kb_documents.machine_id` is `NOT NULL`, FK to `machine_kb` **ON DELETE CASCADE** (`supabase/migrations/20260506141924_initial.sql:23`). Deleting a machine deletes its documents, chunks and assets.
- `kb_chunks.machine_id` and `kb_assets.machine_id` are denormalized copies, `NOT NULL`, no FK. **Search filters on `kb_chunks.machine_id`**, not on the document (`20260918120000_search_v2.sql`, vector and keyword branches of `search_kb` and `search_kb_multi`).
- `kb_max_similarity` filters on `kb_chunks.machine_id` too, and has no `status='ready'` join (`20260813130000_kb_max_similarity.sql`).
- There is **no accounts table**. A document's account is only reachable via `kb_documents.machine_id -> machine_kb.account_id`.
- **No RLS policies and no storage policies exist.** All access goes through the service-role client; the app code is the whole security boundary. So this change is app code plus SQL functions, no policy rewrites.
- `kb_documents.status` has a CHECK constraint that was never altered (`initial.sql:30`). This plan avoids adding statuses.
- `kb_folders` is keyed `(machine_id, path)`; documents point at folders only by the `folder_path` string.
- Precedent: `doc.folder_machines` (`20260526120000_doc_initial.sql:55-78`) is already a link table carrying `account_id` with an account-match trigger. `machine_documents` copies that pattern.

### 4.2 Every code site that reads or writes by machine

Grouped from a full audit. Every row must be handled in the phase named.

| Area | Site | What it does today | Phase |
|---|---|---|---|
| Chat retrieval | `src/app/api/chat/route.ts` `search_kb` tool (RPC `search_kb_multi`) | filter by `kb_chunks.machine_id`, chips per machine | 3 |
| Chat prompt | `chat/route.ts` `buildSystemPrompt` | doc list `.eq("machine_id")`, inside the 1h prompt cache | 3 |
| Chat tools | `chat/route.ts` `list_documents` | `.in("machine_id").eq("operator_visible", true)` | 3 |
| Chat tools | `chat/route.ts` `get_page_image` | auth `allowed.includes(doc.machine_id)` | 3 |
| Chat tools | `chat/route.ts` `executeGetStoredImage` | reads asset by document, no machine check | 3 (verify) |
| Fleet | `src/lib/fleet.ts` `getFleetMachines` | doc count per machine | 3 |
| Voice | `src/lib/searchKb.ts` `searchKb`, `listDocuments` | RPC `search_kb`, `.eq("machine_id")` | 3 |
| Voice | `src/app/api/voice/realtime/session/route.ts` `buildVoiceInstructions` | doc list `.eq("machine_id")` | 3 |
| Suggestions | `src/lib/suggestions.ts` `regenerateSuggestedQuestions` | doc list by machine, RPC `kb_max_similarity` | 3 |
| Transcripts | `src/app/api/conversations/[id]/route.ts` `attachSources` | names chip machine from `kb_documents.machine_id` | 3 |
| Admin | `src/app/api/admin/machines/[id]/route.ts` GET | doc list + folders by machine | 3 |
| Admin | `src/app/api/admin/machines/route.ts` | doc count per machine (reads all accounts, filters in memory) | 3 |
| Admin | `src/app/api/admin/machines/[id]/folders/route.ts` | folder emptiness counts by machine | 4 |
| Admin | `src/lib/autoOrganize.ts` | reads and moves docs `.eq("machine_id")` | 4 |
| Operator | `src/app/api/machines/[id]/documents/route.ts` | `.eq("machine_id").eq("operator_visible", true)` | 3 |
| Operator | `src/app/api/accounts/[id]/documents/route.ts` | `.in("machine_id", fleetIds)` + machine name | 3 |
| Signed URLs | `src/app/api/documents/[id]/url/route.ts` | QR: `row.machine_id === qrMachineId`; bearer: account via machine | 3 |
| Signed URLs | `src/app/api/assets/[id]/url/route.ts` | same, on `kb_assets.machine_id` | 3 |
| Auth | `src/lib/auth.ts` `assertDocumentAccess` | embed `machine_kb!inner(account_id)` via the FK | 3 |
| Ingest PDF | `src/lib/ingestion.ts` `insertPdfDocRow`, `ingestPdfFromStorage` (row-machine 403 check), `insertChunkRows`, `reprocessPdf`, `flipStuck`, `cleanupStuckDocuments`, sweep `resumeStale` | writes `machine_id` on doc and chunks | 1 (trigger), 4 |
| Ingest image/file | `src/lib/imageIngestion.ts`, `src/lib/fileIngestion.ts` | same | 1 (trigger), 4 |
| Experience docs | `src/lib/feedback.ts` `publishExperienceDoc`, `src/lib/distill.ts` | insert doc + chunks with `machine_id` | 1 (trigger) |
| Delete doc | `src/app/api/admin/documents/[id]/route.ts` DELETE | deletes storage object, sidecar, row | 4 |
| Move doc | same route, PATCH | `folder_path`, `operator_visible` on the document | 4 |
| **Delete machine** | `src/app/api/admin/machines/[id]/route.ts` DELETE | **removes every storage object under `${id}/`**, relies on FK cascade | 4 (**blocker for sharing**) |
| CLI | `src/lib/ingestion.ts` `resetMachineKb`, `scripts/ingest.ts` | delete all docs of a machine | 4 |
| Evals | `scripts/eval.ts` | per machine | 3 (run as gate) |

## 5. Target model

```
machine_kb (machine_id, account_id, ...)            unchanged
kb_documents (id, account_id NEW, machine_id = "origin machine", content_sha256 NEW, ...)
machine_documents NEW (machine_id, document_id, account_id, folder_path, operator_visible, created_at, created_by)
kb_chunks, kb_assets                                 unchanged (machine_id becomes "origin", unused by new reads)
kb_document_pages NEW (document_id, page, text_sha256, char_count)       Phase 6
kb_document_coverage NEW (document_id, source_document_id, pages int[]) Phase 6
```

Key decisions:

- **A document is visible on a machine if and only if a `machine_documents` row links them.** All reads go through the link.
- `kb_documents.machine_id` stays, renamed in meaning to **origin machine** (where it was first uploaded). It is used for usage attribution and as a fallback. Nothing authorizes on it after Phase 3.
- **Folder and operator visibility move to the link** (`machine_documents.folder_path`, `machine_documents.operator_visible`). Folders are already per machine (`kb_folders`), so a shared manual can sit in "Electrical" on machine A and in "Manuals" on machine B, and be operator-visible on one but not the other. Title, summary, `meta`, file, chunks are on the document and shared. See open decision D1.
- **Storage paths do not change.** New uploads keep `${machineId}/${documentId}.ext`. The path is just an address. The only code that treats the machine prefix as meaningful is the machine-delete prefix sweep, which Phase 4 removes. (This changes what was said in chat earlier, where account-level paths for new shared documents were suggested. Keeping the scheme means fewer moving parts and no backfill.)
- Matching for duplicates is **always scoped to the caller's account.**

## 6. Safety principles (non-negotiable)

1. **Expand, then switch, never contract (in this project).** Phases 1 and 2 only add columns, tables, functions and triggers. Old code keeps working against the new schema unchanged.
2. **The database guarantees the link exists.** An `AFTER INSERT` trigger on `kb_documents` creates the origin link. Every insert path (PDF, image, file, CLI, experience docs, any path we forgot) is covered without touching that code. The backfill runs after the trigger is created, so in-flight ingests during the migration are covered either way.
3. **Reads switch behind a flag, with rollback in seconds.** New SQL functions live beside the old ones; the old ones are never modified. Flag off means the old path.
4. **Prove parity before switching.** Set equality and search result equality, on all production data, must be exact (§8).
5. **Sharing is enabled only after delete semantics are fixed.** Otherwise deleting one machine could destroy a document another machine relies on. Phase 4 must be live before Phase 5.
6. **Fail open on detection.** If hash checks or page analysis fail or time out, the upload proceeds exactly as today.

## 7. Phases

### Phase 0: baseline (no code)

- Confirm point-in-time recovery is enabled on the Supabase project; otherwise take a manual backup before each migration.
- Record baseline: counts in §3, `npm run eval` report saved under `evals/out/`, and a search snapshot (§8.3) for every machine.
- Note in-flight ingests; prefer to apply migrations when the queue is quiet (not required, the trigger covers it).

### Phase 1: additive schema (migration A, no behavior change)

`supabase/migrations/<ts>_shared_documents_expand.sql`:

```sql
-- 1. account on documents
alter table kb_documents add column account_id text;
update kb_documents d set account_id = m.account_id
  from machine_kb m where m.machine_id = d.machine_id and d.account_id is null;

create or replace function kb_documents_fill_account() returns trigger language plpgsql as $$
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

-- 2. link table (pattern: doc.folder_machines)
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
create or replace function machine_documents_assert_account() returns trigger language plpgsql as $$
begin
  if new.account_id is distinct from (select account_id from machine_kb where machine_id = new.machine_id)
     or new.account_id is distinct from (select account_id from kb_documents where id = new.document_id) then
    raise exception 'machine_documents: account mismatch';
  end if;
  return new;
end $$;
create trigger machine_documents_assert_account before insert or update on machine_documents
  for each row execute function machine_documents_assert_account();

-- 3. every new document gets its origin link automatically
create or replace function kb_documents_link_origin() returns trigger language plpgsql as $$
begin
  insert into machine_documents (machine_id, document_id, account_id, folder_path, operator_visible, created_by)
  values (new.machine_id, new.id, new.account_id, new.folder_path, new.operator_visible, new.created_by)
  on conflict do nothing;
  return new;
end $$;
create trigger kb_documents_link_origin after insert on kb_documents
  for each row execute function kb_documents_link_origin();

-- 4. transition mirror: old code still writes folder_path / operator_visible on the document
create or replace function kb_documents_mirror_link() returns trigger language plpgsql as $$
begin
  update machine_documents
     set folder_path = new.folder_path, operator_visible = new.operator_visible
   where machine_id = new.machine_id and document_id = new.id;
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
```

Plus new, **separate** SQL functions. The old `search_kb`, `search_kb_multi`, `kb_max_similarity` are not touched:

- `search_kb_linked(p_machine_id, ...)`: identical body to `search_kb` except the machine filter becomes
  `join machine_documents md on md.document_id = c.document_id and md.machine_id = p_machine_id`
  in both the vector and keyword branches. Same return type, same diversity caps, same `hnsw.ef_search` and `iterative_scan` settings (re-apply the DO block from `search_v2.sql:299-320`).
- `search_kb_multi_linked(p_machine_ids, ...)`: same, with `md.machine_id = any(p_machine_ids)`. A chunk whose document is linked to several requested machines must appear **once**: pick a deterministic attribution machine (`min(md.machine_id)` among the requested set) for the existing `machine_id` column and the per-machine quota, and add a `machine_ids text[]` column with all of them. New return type, so it is a new function anyway.
- `kb_max_similarity_linked`: same filter change. Keep the current semantics exactly (no `status='ready'` join), so parity holds.

Rollback: `drop` the new functions, triggers, table and columns. Old code never noticed them.

Verification: §8.1 and §8.2 must return zero rows right after the migration.

### Phase 2: file hashes (low risk)

- **Write path:** compute SHA-256 of the downloaded bytes where finalize already holds them and store it in `kb_documents.content_sha256`:
  - PDF: `ingestPdfFromStorage` right after the download, passed into `insertPdfDocRow`.
  - Image: `ingestImageFromStorage` (`fileBuffer`), into the insert in `runImagePipeline`.
  - File: `ingestFileFromStorage` (`fileBuffer`), into its insert.
  - CLI `ingestPdf` / `ingestImage` have the buffer up front.
- **Backfill:** `scripts/backfill-content-hash.ts`. For each document with `storage_path` and null hash: download, hash, update. Idempotent, resumable, batched, run locally (not on Vercel). ~1.46 GB total. Experience docs have no file and stay null.
- Verify: count of non-feedback docs with null hash is 0; spot-check the 36 known duplicate groups now share a hash.

### Phase 3: switch reads behind a flag

Flag: env `KB_LINKS_READ`, value `off` | `on` | comma-separated account ids. Resolved server-side by one helper `useLinkedReads(accountId)` in a new `src/lib/kbLinks.ts`. That file also holds the shared query helpers so call sites don't each re-implement the link join:

- `linkedDocumentIds(machineIds)`, `documentsForMachine(machineId, filters)`, `machinesForDocument(documentId)`, `isDocumentOnMachine(documentId, machineId)`, `documentAccountId(documentId)`.

Change every Phase 3 row in §4.2:

- **Search:** RPC name chosen by the flag (`search_kb` vs `search_kb_linked`, etc.). Chips: when `machine_ids` has more than one entry, label with all machine names (fleet only).
- **Doc lists** (chat prompt, voice prompt, `list_documents`, operator routes, admin machine GET, suggestions): query through `machine_documents`, taking `folder_path` and `operator_visible` from the link. **Keep the exact same ordering and fields**, so the chat system prompt stays byte-identical and the 1h prompt cache is not invalidated by the switch.
- **Counts** (`getFleetMachines`, admin machines list): count links. Also fix the admin machines list to scope to the caller's accounts while there.
- **Auth:**
  - `assertDocumentAccess`: check `kb_documents.account_id` directly, no FK embed.
  - Document and asset signed-URL routes: QR session allowed if `isDocumentOnMachine(doc, qrMachineId)`; bearer allowed if the document's `account_id` matches. Assets resolve through `kb_assets.document_id`.
  - `get_page_image`: allowed if the document is linked to any machine in `allowedMachineIds`.
  - `ingestPdfFromStorage` row check: stays as is (it guards a document being created on this machine; unchanged meaning).
- **Transcripts** (`attachSources`): name machines from links intersected with the conversation's machines.

Rollout: our own account first, then all. Before each step run §8 parity. Rollback: set the flag to `off`.

Exit criteria: flag `on` for all accounts for at least one week, evals green, no access errors in logs.

### Phase 4: switch writes and fix delete semantics (must ship before Phase 5)

Migration B:

```sql
alter table kb_documents alter column machine_id drop not null;
alter table kb_documents drop constraint kb_documents_machine_id_fkey;
alter table kb_documents add constraint kb_documents_machine_id_fkey
  foreign key (machine_id) references machine_kb(machine_id) on delete set null;
```

From here a document outlives its origin machine. Deleting a machine removes its links (FK cascade on `machine_documents`) and only nulls the origin.

Code:

- **Delete document becomes "remove from this machine".** New route `DELETE /api/admin/machines/[id]/documents/[docId]`: delete the link; if no links remain, run the existing full delete (storage object, sidecar, row, cascade). Regenerate suggestions for that machine. The old `DELETE /api/admin/documents/[id]` becomes "delete everywhere" (full delete, regenerate suggestions for every machine that was linked). `MachineDetail.tsx` single and bulk delete call the new route.
- **Delete machine:** replace the `${id}/` prefix sweep with: collect the machine's linked documents; delete the machine (cascade removes links, nulls origins); for each collected document with zero remaining links, run the full delete. Shared documents survive. Leftover orphans are handled by a separate, read-first sweep script (§9.4).
- **`resetMachineKb` (CLI):** same rule as machine delete.
- **Folders and visibility:** PATCH move and visibility, auto-organize, folder emptiness checks write and read `machine_documents` for the machine in context. After this, drop the mirror trigger (migration C) in the same deploy, since nothing writes those fields on the document any more. Keep `kb_documents.folder_path`/`operator_visible` columns, unused.
- **Document changes reach every machine:** reprocess, title/summary edit and ingest completion call `regenerateSuggestedQuestionsSafe` for every linked machine, not just the origin.
- **Ingest guards that are by machine** (`flipStuck`, `cleanupStuckDocuments`): keep by origin, plus allow `null` origin (skip machine filter).

Rollback: flag off restores reads. Migration B is not reverted (relaxing a constraint is harmless to old code). If sharing (Phase 5) has not been enabled, there is no data the old path cannot see.

### Phase 5: link instead of upload

Gate: `account_flags.shared_documents boolean default false` (existing per-account flag table, `src/lib/accountFlags.ts`). Only accounts with Phase 3 reads on.

- **Check endpoint** `POST /api/admin/ingest/check` `{ machineId, files: [{ name, size, sha256 }] }`. Auth: `assertMachineAccess`. Looks up `content_sha256` in the machine's account only, excluding `failed` documents. Returns per file one of:
  - `none`
  - `on_this_machine { documentId, title }`
  - `on_other_machines { documentId, title, machines: [{ id, name }] }`
- **Client hashing:** in `UploadCard` handlers (`MachineDetail.tsx`), hash with `crypto.subtle.digest('SHA-256', await file.arrayBuffer())` before `enqueueUploads`. Max file is 100 MB (bucket limit), acceptable in memory. Show a "Checking files..." state. If hashing or the check fails, enqueue as today (fail open).
- **Batch dialog** when any file matched (one dialog per drop, not per file), with per-file choices preselected:
  - matched on another machine: **Link** (default) / Upload anyway / Skip
  - matched on this machine: **Skip** (default) / Upload anyway
  - buttons: "Apply", "Upload all anyway"
  - Built on the existing `AutoOrganizeDialog` pattern (`useFocusTrap`, `dialog-overlay`/`dialog-panel`, `Checkbox`, `Button`). **Needs a design reference before building** (CLAUDE.md; open decision D6).
- **Link endpoint** `POST /api/admin/machines/[id]/documents/link` `{ documentId, folderPath }`: `assertMachineAccess`, verify the document's account matches, insert link (`ensureFolderPath` first), regenerate suggestions for this machine. Idempotent.
- **"Shared with N machines" tag** in the machine document list (existing `Tag` component), with the machine names in a tooltip. Delete on a shared document asks "Remove from this machine" vs "Delete from all N machines" (`useConfirm` covers the two-way case; a three-way needs the dialog pattern).
- The server hash computed at finalize (Phase 2) is authoritative. A wrong client hash can only cause a missed match or a link offer to a document in the same account, never a cross-account leak, because the check is account-scoped.

### Phase 6: process only the new pages (PDF)

**6a. Page fingerprints.** New table:

```sql
create table kb_document_pages (
  document_id uuid not null references kb_documents(id) on delete cascade,
  page        int  not null,
  text_sha256 text not null,
  char_count  int  not null,
  primary key (document_id, page)
);
create index kb_document_pages_sha_idx on kb_document_pages (text_sha256);
```

- Hash the **pdf-parse text layer** per page (not the OCR text), because a new upload can only cheaply produce the text layer. Normalize: Unicode NFKC, collapse whitespace, trim. Skip pages under `OCR_PAGE_MIN_CHARS` (100) characters: unhashable, always treated as new.
- `extractPdfText` (`src/lib/pdfText.ts`) returns the text-layer pages alongside the result; `runPdfPipelineSteps` writes them at the swap point (where the complete sidecar is written).
- Backfill: `scripts/backfill-page-hashes.ts`, runs `parseWithRepair` (to be exported) on each stored PDF locally. The 90 MB / 1930-page Kvik manual is the worst case; run with no deadline.

**6b. Analyze step after upload, before finalize.**

- `POST /api/admin/ingest/analyze { machineId, documentId }` after the PUT (split point: `directUpload` in `src/admin/adminApi.ts`, between `putToSignedUrl` and finalize). Downloads the object, parses the text layer with a deadline, hashes pages, matches against `kb_document_pages` joined to `kb_documents` in the same account.
- Returns `{ pageCount, matches: [{ documentId, title, machines, pages: [ranges], sourcePages: [ranges] }], newPages: [ranges] }`.
- **Offer only when it is worth it:** at least 5 matched pages and at least 20% of the file, from a single source document (v1). Ignore page hashes that occur in 3 or more documents of the account (cover pages, blank templates, generic TOCs).
- No row exists yet, so no new `kb_documents.status` is needed.

**6c. Decision in the upload queue.**

- New queue status `needs_decision` in `uploadQueue.tsx` (`processNext` only picks `pending`, so parked items are skipped naturally; extend `hasActive` and the panel counts). Item row shows: "Pages 1 to 40 already exist in 'KF1 ...' (on Machine A). Process only pages 41 to 52?" with **Only new pages** / **Process everything** / **Cancel upload**.
- Cancel deletes the uploaded storage object.
- The remaining items keep processing while one waits.

**6d. Skipping pages in the pipeline.** Persist on the row so the sweep and reprocess see it:

```sql
alter table kb_documents add column skip_pages int[];
create table kb_document_coverage (
  document_id        uuid not null references kb_documents(id) on delete cascade,
  source_document_id uuid not null references kb_documents(id) on delete restrict,
  pages              int[] not null,
  primary key (document_id, source_document_id)
);
```

Threading `skip_pages` (from the ingest audit):

1. `insertPdfDocRow` writes it; `PipelineArgs` reads it; finalize `makeBody` in `adminApi.ts` sends it on both the first call and the resume path, since `postJsonUntilDone` re-sends the body.
2. `extractPdfText`: remove skipped pages from `allPages` and `scannedPages`; pass into `repairTables`/`tablePages` and **filter before the `MAX_TABLE_PAGES = 60` cap**; compute the too-thin whole-document decision over kept pages only; blank skipped pages' text but **keep their `<<<page:N>>>` markers**, so every kept page keeps its original page number.
3. Figures: filter in `extractPdfFigures` after `figurePages` (before its 150 cap) **and** on the returned figures, since the fallback sends the whole PDF.
4. Chunking and embedding need no change: blank pages produce no chunks; page numbers stay original.
5. `ensureDocumentMeta` would see only the new pages: copy `meta` from the source document instead of re-deriving.
6. `page_count` stays the full file's page count. The full KF2 PDF is stored, so citations, `#page=` links and `get_page_image` keep working.
7. Bump `SIDECAR_VERSION` so in-flight sidecars from before the change re-extract cleanly.

Behavior:

- If the source document is on another machine, "Only new pages" also links the source to this machine (otherwise pages 1 to 40 would not be searchable here). The dialog says so.
- Answers about pages 1 to 40 cite KF1 with KF1's page numbers.
- **Dependency guard:** `on delete restrict` on `source_document_id` stops a full delete of KF1 while KF2 depends on it. Unlinking or deleting KF1 on a machine where KF2 depends on it shows: "KF2 relies on pages from this document. Reprocess KF2 fully, or cancel." Reprocess clears `skip_pages` and the coverage row.
- `evals/README.md` requires all deterministic evals to pass before changes to `extractPdfText`/`chunkText` ship. With `skip_pages` empty the code path must be byte-identical; add an eval that ingests a small KF1/KF2-style pair.

### Phase 7: tidy up (optional, months later)

Stop writing `kb_chunks.machine_id`/`kb_assets.machine_id`, drop the old search functions, drop the flag. Only after Phase 5 has run without incident for a long time. Not required.

## 8. Verification

### 8.1 Link completeness (must be zero rows, run after Phase 1 and before every rollout step)

```sql
-- every document has its origin link
select d.id from kb_documents d
left join machine_documents md on md.document_id = d.id and md.machine_id = d.machine_id
where d.machine_id is not null and md.document_id is null;

-- no link crosses accounts
select md.* from machine_documents md
join kb_documents d on d.id = md.document_id
join machine_kb m on m.machine_id = md.machine_id
where md.account_id <> d.account_id or md.account_id <> m.account_id;
```

### 8.2 Set equality per machine (before Phase 5, must be zero rows)

```sql
(select machine_id, id from kb_documents
 except select machine_id, document_id from machine_documents)
union all
(select machine_id, document_id from machine_documents
 except select machine_id, id from kb_documents);
```

Also folder and visibility parity: `kb_documents.folder_path/operator_visible` equal to the origin link's values.

### 8.3 Search parity (script `scripts/verify-kb-links.ts`)

For every machine, for the eval questions plus 20 sample queries per machine (titles and summary phrases), call old and new functions with the same embedding and compare: identical `chunk_id` order and scores for `search_kb` vs `search_kb_linked`, same for `search_kb_multi` on each account's fleet, and identical `kb_max_similarity`. Any difference blocks the rollout. Also record `explain analyze` timings for both; the new one must not be materially slower.

### 8.4 App-level checks

- `npm run lint`, `tsc --noEmit`, `npm run eval` with all deterministic cases green.
- The chat system prompt for each machine is byte-identical with the flag off and on (log a hash of the system block in a one-off script).
- Manual smoke per phase in a test account: upload PDF/image/xlsx, ask with citations, open cited page, QR session view, operator document list, fleet chat, move to folder, toggle visibility, delete, delete machine.

## 9. Risks and edge cases

1. **Machine delete destroying shared files.** Today it sweeps the `${id}/` storage prefix. Legacy files of a document shared later still live under the origin prefix. Fixed in Phase 4, which is why Phase 5 depends on it.
2. **Rolling reads back after sharing exists.** The old functions only see origin machines, so linked machines would lose shared documents until the flag goes back on. Acceptable as an emergency measure; documented, not silent.
3. **Fleet duplicates.** A shared document must appear once in fleet search and fleet lists. Handled in `search_kb_multi_linked` and the account documents route.
4. **Orphan storage objects.** After Phase 4 no prefix sweep exists. A script lists objects in `kb-documents`/`kb-images` not referenced by any `kb_documents.storage_path`, sidecar, or `kb_assets.storage_path`, prints them, and deletes only with an explicit `--delete`.
5. **Prompt cache.** Any change in doc list order or format invalidates the 1h prompt cache and changes behavior. Parity check in §8.4.
6. **Scanned PDFs.** No text layer, so page overlap is invisible in v1. Whole-file duplicates are still caught by the file hash. A v2 could hash each page's raw content stream via pdf-lib, or a downscaled render.
7. **Same text, different figure.** Two pages with identical text but a changed diagram would be skipped. The user sees the page ranges and decides; v1.1 could also compare the image-object count per page from `analyzePdfFigures`.
8. **Concurrent ingest during migration.** Covered by trigger-before-backfill ordering.
9. **Cross-account leak.** All matching is account-scoped in SQL; the link trigger rejects cross-account links.
10. **Pre-existing gap, out of scope:** the voice routes do not check a bearer caller's machine against their account (`src/app/api/voice/realtime/tool/route.ts`, `session/route.ts`). Worth fixing separately.

## 10. Open decisions for review

- **D1. Folder and operator visibility per link (recommended) or per document?** Per link is more correct but needs the mirror trigger during transition.
- **D2. Who may "delete everywhere"?** Recommended: any admin of the account, with a confirm listing the machines.
- **D3. Flag granularity for reads:** env allowlist (recommended, simple) vs `account_flags` column.
- **D4. Overlap threshold** (5 pages and 20%, single source, boilerplate filter at 3 docs). Tune with Kristian's real files.
- **D5. Are Kristian's KF files scanned or digital?** If scanned, Phase 6 needs the content-stream hash from the start.
- **D6. Design references needed** (CLAUDE.md "never invent UI components"): the batch duplicate dialog, the per-item decision row, the "Shared with N machines" tag, and the remove/delete-everywhere confirm.
- **D7. Same-machine exact duplicates** (36 today): offer a one-off cleanup tool, or leave them?

## 11. Effort (rough)

| Phase | Size | Can ship alone |
|---|---|---|
| 0 Baseline | hours | yes |
| 1 Expand schema + new functions | 1 day | yes, no behavior change |
| 2 Hashes + backfill | 0.5 day | yes |
| 3 Read switch + parity script | 2 to 3 days | yes, behind flag |
| 4 Writes + delete semantics | 2 days | yes |
| 5 Link instead of upload | 2 to 3 days + design | after 4 |
| 6 New pages only | 4 to 5 days | after 5 |

Phases 1 to 4 change nothing the user can see. They are where the production risk lives, and each one is verified and reversible on its own.
