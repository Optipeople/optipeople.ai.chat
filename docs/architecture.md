# OptiAI Chat — Product Architecture & Roadmap

This document turns the current MVP into a real product. It defines the
target architecture, the data model, the backends we need to build, and
a phased plan that gets us there without a rewrite.

## 1. Where we are today

The MVP lives in a single Express server ([server/index.js](server/index.js))
that loads one global knowledge base ([server/knowledge.json](server/knowledge.json))
extracted from PDFs in [knowledgebase/](knowledgebase/). The client
([client/src/App.tsx](client/src/App.tsx)) is a Vite + React + Tailwind +
shadcn app with three pre-chat screens:

1. Login against Optipeople ([client/src/auth/authApi.ts](client/src/auth/authApi.ts))
2. Account picker ([client/src/components/AccountSelectScreen.tsx](client/src/components/AccountSelectScreen.tsx))
3. Machine picker ([client/src/components/MachineSelectScreen.tsx](client/src/components/MachineSelectScreen.tsx))

The chat call already sends `accountId` and `machineId`
([server/index.js:73](server/index.js#L73)), but the server ignores them
and serves the same single-machine knowledge to everyone. There is no
persistence — no chats, no audit, no ability to add knowledge without a
git commit and a redeploy.

That is what we are fixing.

## 2. Product principles (what stays true through every phase)

- **Optipeople is the source of truth** for users, accounts and machines.
  We never duplicate that master data; we reference it by ID.
- **Machine ID is the partition key** for everything: knowledge, chats,
  feedback, escalations, QR codes.
- **Operators must not feel any of this.** The shop-floor UX stays
  one-tap-and-ask. Architecture happens behind the screen.
- **Every answer is auditable.** A service tech, a quality auditor, or
  an OEM should be able to reconstruct what the AI told whom, on which
  machine, with which knowledge base version.
- **Knowledge is a living asset, not a static dump.** Operators’ proven
  fixes flow back into the KB through the feedback loop.
- **Agentic retrieval is the only retrieval path.** The model sees a
  small, cached system prompt (persona + per-machine document manifest +
  tool schemas) and pulls relevant sections on demand via tool calls.
  No "stuff the manual into the prompt" mode, no per-machine retrieval
  flag. One code path, well-built.

## 3. Target architecture

```
                              ┌──────────────────────────────┐
                              │      Optipeople platform     │
                              │  (users, accounts, machines, │
                              │   tokens — already live)     │
                              └──────────────┬───────────────┘
                                             │ OAuth2 (bearer)
                                             ▼
 ┌────────────────────────┐    ┌──────────────────────────────┐    ┌─────────────────────┐
 │  Operator client (PWA) │◄──►│        OptiAI backend        │◄──►│  Anthropic API      │
 │  - chat                │    │  (Node/Express, evolves into │    │  Haiku 4.5 / Sonnet │
 │  - QR entry            │    │   a small service)           │    │  + prompt caching   │
 │  - escalation button   │    │                              │    └─────────────────────┘
 │  - feedback prompt     │    │  Routes:                     │
 └────────────────────────┘    │   /api/chat        operator  │    ┌─────────────────────┐
                               │   /api/feedback    operator  │◄──►│  Postgres           │
 ┌────────────────────────┐    │   /api/escalations operator  │    │  (Supabase or       │
 │  Admin UI (web)        │◄──►│   /api/admin/*     super-adm │    │   Azure Postgres)   │
 │  - per-machine KB CRUD │    │   /auth-api/*      proxy     │    └─────────────────────┘
 │  - audit / chat search │    │                              │
 │  - feedback inbox      │    │  Pipelines:                  │    ┌─────────────────────┐
 └────────────────────────┘    │   PDF ingest → chunks        │◄──►│  Object storage     │
                               │   feedback → KB curation     │    │  (Supabase Storage  │
                               └──────────────────────────────┘    │   or Azure Blob)    │
                                                                   └─────────────────────┘
```

### 3.1 Storage — Supabase (Postgres + Storage + pgvector)

**Decided.** Supabase gives us Postgres, object storage and pgvector in
one managed product. RLS gives us per-account isolation almost for free
once we map the Optipeople JWT to a Supabase claim.

Application code talks to "a Postgres" and "an object store" through
thin adapters, so if ops later mandates the Optipeople Azure tenant the
same schema and ingestion pipeline port to Azure Postgres + Blob — no
application rewrite, only infra.

### 3.2 Data model (initial)

All IDs that originate in Optipeople (`account_id`, `machine_id`,
`user_id`) are stored as opaque strings — we never copy master data.

```sql
-- A machine's KB lives in one row + N documents + N*M chunks.
machine_kb (
  machine_id              text primary key,     -- Optipeople machine id
  account_id              text not null,        -- denormalised for RLS
  display_name            text,                 -- cached for admin UI only
  system_prompt_extra     text,                 -- per-machine prompt overrides
  active_embedding_model  text not null
                          default 'voyage-4-large',  -- which embedding rows
                                                     -- search_kb queries against
  updated_at              timestamptz default now()
)

kb_documents (
  id              uuid primary key,
  machine_id      text references machine_kb,
  title           text not null,                -- "Software manual"
  summary         text not null,                -- 1–2 sentences. Goes into the
                                                -- per-machine manifest the model
                                                -- sees — drives query quality.
  source_type     text not null,                -- pdf | url | manual_note | feedback
  storage_path    text,                         -- key in object store, null for inline
  byte_size       bigint,
  page_count      int,
  status          text not null,                -- uploaded | extracting | embedding | ready | failed
  created_by      text not null,                -- admin user id
  created_at      timestamptz default now()
)

kb_chunks (
  id              uuid primary key,
  document_id     uuid references kb_documents on delete cascade,
  machine_id      text not null,                -- denormalised for fast filter
  ordinal         int not null,
  page_from       int,
  page_to         int,
  text            text not null,
  text_tsv        tsvector generated always as (to_tsvector('simple', text)) stored,
  embedding       vector(1024) not null,        -- voyage-4-large @ 1024 dims (Matryoshka)
  embedding_model text not null                 -- e.g. "voyage-4-large".
                                                -- Lets us run two models side-by-side
                                                -- during a model upgrade and flip
                                                -- machines over one at a time.
)
-- One row per (document, ordinal, embedding_model) — re-embedding inserts new
-- rows rather than overwriting, so we can blue/green a model upgrade.
-- Hybrid search needs both indexes:
-- create index on kb_chunks using gin (text_tsv);
-- create index on kb_chunks using ivfflat (embedding vector_cosine_ops);

-- Audit + future feedback signal.
conversations (
  id              uuid primary key,
  machine_id      text not null,
  account_id      text not null,
  user_id         text not null,                -- operator
  started_at      timestamptz default now(),
  ended_at        timestamptz,
  entry_mode      text,                         -- qr | manual | deep_link
  resolution      text                          -- resolved | unresolved | escalated | unknown
)

messages (
  id              uuid primary key,
  conversation_id uuid references conversations on delete cascade,
  role            text not null,                -- user | assistant | tool
  content         text not null,                -- assistant text, or JSON for tool calls/results
  tool_name       text,                         -- search_kb | read_section | list_documents
  tool_input      jsonb,                        -- query, doc_id, etc.
  tool_chunks     uuid[],                       -- kb_chunks.id pulled in by this turn
  tokens_in       int,
  tokens_out      int,
  cache_hit       boolean,
  created_at      timestamptz default now()
)

feedback (
  id              uuid primary key,
  conversation_id uuid references conversations,
  resolved        boolean not null,
  solution_text   text,                         -- operator describes the fix
  promoted_doc_id uuid references kb_documents, -- set when admin promotes to KB
  created_at      timestamptz default now()
)

escalations (
  id              uuid primary key,
  conversation_id uuid references conversations,
  channel         text not null,                -- phone | email | service_ticket
  target          text not null,                -- e.g. phone number, email
  context_blob    jsonb,                        -- snapshot of chat + machine state
  created_at      timestamptz default now()
)
```

RLS: `account_id` on every row + a JWT claim from Optipeople gives us
per-tenant isolation almost for free.

### 3.3 Knowledge ingestion pipeline

Replaces the current `npm run extract` script
([server/extract-pdfs.js](server/extract-pdfs.js)). Lives in the backend,
triggered by the admin UI:

1. Admin uploads a PDF (or pastes a note / links a URL), picks a target
   `machine_id`, and writes a 1–2 sentence **summary** ("Operator-level
   maintenance: lubrication, filter changes, sensor cleaning"). The
   summary is mandatory — it goes into the manifest the model sees and
   directly drives retrieval quality.
2. Backend writes the original to object storage and inserts
   `kb_documents` with status `uploaded`.
3. Worker extracts text per page, splits into ~800–1200 token chunks
   with ~100 token overlap, writes `kb_chunks`. Status → `embedding`.
4. Worker computes embeddings (one batch call) and writes them into
   `kb_chunks.embedding`. Status → `ready`.

Embedding is **part of Phase 1**, not deferred. Without it, agentic
retrieval falls back to keyword-only and quality suffers on questions
phrased differently from the manual.

Versioning: replacing a manual creates a new `kb_documents` row; old
rows are kept for audit, but only `status='ready'` rows show up in the
manifest and search results.

### 3.4 Chat path (agentic retrieval, per-machine, audited)

The model never sees the manuals up front. It sees a small, cacheable
system prompt and a set of tools, and pulls what it needs.

**System prompt (cached, ~stable per machine)**

```
- Persona: OptiAI, dansk, kort og præcis…  (the existing preamble)
- Safety rules
- Tool schemas (below)
- Per-machine manifest: list of {document_id, title, summary, page_count}
- Per-machine prompt extras (machine_kb.system_prompt_extra)
```

This whole prefix is sent with `cache_control: { ttl: "1h" }`. Cache
key naturally becomes "MODEL + machine_id + KB version". A manifest of
50 documents at ~30 tokens each is ~1.5k tokens — trivial to cache, and
it lets the model reason about *which* document is likely to contain
the answer before searching.

**Tools the model can call**

- `search_kb(query: string, top_k: int = 6)` — hybrid search over
  `kb_chunks` scoped to the active machine. Server runs BM25 (tsvector)
  and vector search in parallel, fuses with Reciprocal Rank Fusion,
  returns `[{document_id, title, page_from, page_to, snippet}]`.
- `read_section(document_id: uuid, page_from: int, page_to: int)` —
  fetches the full text of a contiguous page range. Used when the
  search snippet is promising but the model needs more context (e.g.
  full procedure, surrounding paragraphs).
- `list_documents()` — returns the manifest. Rarely needed since it's
  already in the system prompt, but available as a fallback.

**Loop**

1. Authenticate operator via Optipeople bearer token (server-side, not
   dev-proxied).
2. Load (or create) the conversation row, append user turn to
   `messages`.
3. Stream a `messages.create` with the cached system prompt, tool
   schemas, and full conversation history. Anthropic's tool-use loop
   handles the model→tool→model bounce.
4. For every tool call, log a `messages` row with `role='tool'`,
   `tool_name`, `tool_input`, `tool_chunks` (the chunk IDs returned).
   That gives us the audit trail and the citations come for free.
5. When the model emits text deltas, stream them to the client (same
   SSE pattern as today). On stop, flush usage + cache stats to the
   final assistant `messages` row.

**No fallback "stuff the manual" mode.** The MVP code at
[server/index.js:97-105](server/index.js#L97-L105) gets rewritten, not
parameterised: the system prompt builder takes a `machine_id`, fetches
the manifest, and never reads chunk bodies.

## 4. Roles and authorization

We can lean on Optipeople for identity but we still need our own role
table or claim mapping for OptiAI-specific permissions:

| Role | Can do |
|---|---|
| `operator` | Chat on machines they have Optipeople access to. See their own conversations. Submit feedback / escalate. |
| `account_admin` | Everything an operator can. Read all conversations and feedback for **their account**. Cannot edit KB. |
| `super_admin` | Everything. Upload/edit/delete KB for any machine. Promote feedback to KB. Cross-account audit. |

`super_admin` should be small and Optipeople-internal at first. The
admin UI lives at `/admin` and is fully gated behind that role.

## 5. The admin UI (new)

A second view in the same client app — same auth, same theming, behind
a role gate. Routes:

- `/admin/machines` — search across accounts; shows KB status per
  machine (docs count, last update, whether ready).
- `/admin/machines/:id` — list of `kb_documents`, drag-drop upload, set
  per-machine prompt overrides, preview the active KB.
- `/admin/machines/:id/conversations` — chat audit, filterable by date /
  resolution / operator.
- `/admin/feedback` — inbox of "did we solve it?" responses with a
  one-click *Promote to KB* action that creates a `kb_documents` of type
  `feedback`.

Keep it intentionally boring: shadcn table + drawer + form. No fancy
dashboard — that comes after we have data worth charting.

## 6. Operator features beyond chat

### 6.1 QR access

QR encodes `https://optiai.chat/m/<machine_id>?t=<short-token>`. On
landing:

- If the token is valid and the user is already authenticated in
  Optipeople, jump straight to chat for that machine, recording
  `entry_mode = 'qr'`.
- If not authenticated, run the normal Optipeople login, then continue
  to that machine — skipping the account and machine pickers since the
  QR resolved both.

The token is signed and short-lived (rotated nightly) so a photographed
QR can't be exfiltrated and used months later.

### 6.2 Escalation

A persistent "Tilkald service" button in the chat header. When pressed:

1. Backend snapshots the conversation + machine context.
2. We look up the *escalation target* (configured per account/machine
   in the admin UI: phone, email, ticketing endpoint).
3. We open `tel:` / `mailto:` / push to ticketing. The conversation is
   marked `resolution = 'escalated'`. The receiving tech opens a link
   that shows the full conversation transcript.

Configurability per account is essential — service routing differs by
customer.

### 6.3 Feedback loop

After the assistant marks a turn as a probable resolution (or after N
minutes of inactivity), prompt the operator: *"Løste det problemet?"*

- **Yes**: ask for one-line description if the fix isn't already in
  chat. Save into `feedback`. A super-admin reviews and promotes.
- **No**: surface the escalation button.

Promotion creates a `kb_documents` row with `source_type = 'feedback'`,
re-indexes that machine's chunks, and the next chat picks it up
automatically.

## 7. Phased plan

Each phase ends with something demoable. We don't start a phase until
the previous one is in production for a real machine.

### Phase 1 — Per-machine KB + admin upload + agentic retrieval (≈3 weeks)

- Stand up Supabase with the schema above (Postgres, Storage, pgvector,
  RLS keyed off the Optipeople JWT).
- Build the ingestion pipeline server-side: PDF → text → chunk →
  embed → ready. Port `extract-pdfs.js` into it.
- Implement the three tools — `search_kb` (hybrid BM25 + vector with
  RRF fusion), `read_section`, `list_documents`.
- Rewrite the chat endpoint around Anthropic's tool-use loop. Cached
  system prompt = persona + manifest + tool schemas.
- Build `/admin/machines` and `/admin/machines/:id` views (upload with
  mandatory summary field, list, delete, re-index).
- Migrate the current Felder manuals into the new system as the first
  real machine.

**Done when:** a super-admin can add a new machine's manuals through
the UI and an operator picking that machine gets answers driven by
agentic retrieval over those manuals — with no redeploy.

### Phase 2 — Chat persistence + audit (≈1 week)

- Persist `conversations` and `messages` for every chat.
- Conversation list view in admin.
- Move the dev-only `/auth-api/*` Vite proxy onto the backend (already
  tracked in [docs/todo.md](docs/todo.md)).

**Done when:** every operator chat is replayable from the admin UI.

### Phase 3 — QR access (≈3 days)

- Token generation endpoint + signed URL helper.
- Deep-link route in the client; skips picker screens.
- QR sticker generator in admin (a button per machine that produces a
  printable PDF).

### Phase 4 — Escalation (≈1 week)

- Per-account escalation target config in admin.
- Escalation button + snapshot endpoint.
- Read-only transcript view for service techs (no Optipeople login
  required if they have a signed link — short TTL).

### Phase 5 — Feedback loop (≈1 week)

- Resolution prompt in chat.
- `feedback` capture endpoint.
- Admin "promote to KB" action; re-ingestion on promote.

### Phase 6 — Retrieval quality tuning (continuous, not a milestone)

Retrieval is in from day one, so this phase is about measuring and
improving it rather than turning it on. Triggered by signals from the
audit log:

- Eval set: take 100 real operator questions from `messages` + the
  promoted feedback that resolved them. Build a regression test that
  scores whether `search_kb` returns the chunks that contain the known
  answer.
- Tune chunking (size, overlap, section-aware splitting on PDF
  headings).
- Tune fusion weights (BM25 vs vector) per machine if needed.
- Add query-rewriting: prepend a small "rewrite the operator's question
  into a search query in the manual's language" step inside `search_kb`
  if recall is poor.
- Consider a reranker (Cohere Rerank or similar) on top-20 → top-6 if
  precision becomes the bottleneck.

## 8. Things we explicitly defer

These come up naturally but aren't worth building yet:

- A native mobile app. The PWA is fine for a tablet at the machine.
- Multi-language UI. Backend already answers in Danish; UI strings can
  follow when we have a non-Danish customer asking.
- Fine-tuning a model on a customer's manuals. Prompt caching +
  agentic retrieval beats it on every axis until proven otherwise.
- Real-time observability dashboards. We get raw data into Postgres in
  Phase 2; Metabase or similar can read it later when we know what we
  want to look at.

## 9. Open questions to resolve before Phase 1

1. **Super-admin identity** — do we expose `super_admin` as an
   Optipeople role/claim, or maintain a small allowlist in our own DB
   keyed by Optipeople user ID? The latter is faster; the former is
   cleaner long-term.
2. **PDF extraction quality** — the current pdfjs path is fine for
   text-native PDFs but loses scans and image-only manuals. Worth a
   spike on OCR before Phase 1 ingest goes live.
3. **Multilingual quality of voyage-4-large** — the model is decided
   (voyage-4-large @ 1024d, Matryoshka), but Voyage's docs don't lead
   with multilingual benchmarks. Manuals arrive in English / German /
   Italian and operators ask in Danish, so before Phase 1 ingest goes
   live, run a 20-question eval (Danish question → expected
   English/German chunk) to confirm cross-lingual recall is acceptable.
   If it isn't, fall back to `embed-multilingual-v3` (Cohere); the
   schema's `embedding_model` column makes the swap a config change,
   not a migration.
4. **Data residency** — any customer who needs EU-only storage? Drives
   the Supabase region choice. Likely yes — pick `eu-central-1` or
   `eu-west-1` from the start.
