# OptiAI Chat — Architecture Diagram

A snapshot of how the app actually works today (post-Phase 4). For the
roadmap version of this story, see [architecture.md](architecture.md).

## 1. Big-picture view

```
                  ┌─────────────────────────────────────────────────────┐
                  │                  Optipeople platform                │
                  │   identity • accounts • machines • OAuth bearers    │
                  └───────────────────────┬─────────────────────────────┘
                                          │ Bearer (operator)  +  GetCurrentUser (admin gate)
                                          ▼
 ┌─────────────────────┐        ┌───────────────────────────────────────┐        ┌──────────────────────┐
 │  Operator client    │  HTTPS │           Next.js 16 App              │  HTTPS │  Anthropic API       │
 │  (PWA, Next pages)  │◄──────►│  ──────────────────────────────────── │◄──────►│  Claude Haiku 4.5    │
 │  • / chat           │  SSE   │   App Router pages   API route        │        │  + prompt caching    │
 │  • QR landing       │        │     (operator)        handlers        │        │  + tool-use loop     │
 │  • escalate button  │        │                                       │        └──────────────────────┘
 │  • feedback prompt  │        │  Operator routes:                     │
 └─────────────────────┘        │   POST /api/chat              (SSE)   │        ┌──────────────────────┐
                                │   POST /api/chat/feedback             │  HTTPS │  Voyage AI           │
 ┌─────────────────────┐        │   POST /api/chat/escalate             │◄──────►│  voyage-4-large      │
 │  Admin UI (web)     │  HTTPS │   POST /api/qr/resolve                │        │  (1024-d embeddings) │
 │  /admin/...         │◄──────►│   GET  /api/escalations/[token]       │        └──────────────────────┘
 │  (super-admin only) │        │   GET  /api/machines/[id]/suggestions │
 └─────────────────────┘        │   GET  /api/registered                │        ┌──────────────────────┐
                                │                                       │        │  Resend              │
 ┌─────────────────────┐        │  Admin routes (require SuperAdmin):   │◄──────►│  transactional email │
 │  Service tech       │  HTTPS │   /api/admin/machines[/...]           │        │  (escalation emails) │
 │  (signed link, no   │◄──────►│   /api/admin/conversations/[id]       │        └──────────────────────┘
 │   login required)   │        │   /api/admin/documents/[id][/...]     │
 └─────────────────────┘        │   /api/admin/ingest                   │        ┌──────────────────────┐
                                │   /api/admin/accounts/[id]/escalation │        │  Customer webhooks   │
                                └────┬───────────────────────┬──────────┘  HTTPS │  (per-account        │
                                     │                       │              ────►│   ticketing system)  │
                                     │                       │                   └──────────────────────┘
                                     ▼                       ▼
                          ┌──────────────────────┐  ┌──────────────────────┐
                          │  Supabase Postgres   │  │  Supabase Storage    │
                          │  + pgvector          │  │  pdfs/<machine>/...  │
                          │                      │  │                      │
                          │  RPC: search_kb      │  │  Originals + signed  │
                          │  (BM25 ⊕ vector RRF)│  │  URLs for download   │
                          └──────────────────────┘  └──────────────────────┘
```

Everything lives in one Next.js project. The "backend" is just the
`src/app/api/**/route.ts` handlers — there is no separate server.

## 2. Chat request flow (the hot path)

```
 Operator types question in browser
           │
           ▼
 POST /api/chat   ── headers: Authorization: Bearer <opti-token>   OR   X-QR-Token
 [src/app/api/chat/route.ts]
           │
           ├─ resolve user
           │     • bearer  → Optipeople GetCurrentUser
           │     • qrToken → machine_kb.qr_token lookup     (entry_mode = 'qr')
           │
           ├─ load/create conversations row + persist user message
           │
           ├─ buildSystemPrompt(machineId)
           │     SELECT id,title,summary,page_count FROM kb_documents
           │      WHERE machine_id = $1 AND status = 'ready'
           │     → "Available documents:" manifest baked into system prompt
           │
           └─ Anthropic tool-use loop (≤ 6 iterations)
                  ┌────────────────────────────────────────────────────┐
                  │ messages.stream(                                   │
                  │   model: claude-haiku-4-5,                         │
                  │   system: [{ ...persona+manifest, cache: 1h }],    │
                  │   tools:  [search_kb],                             │
                  │ )                                                  │
                  └────────────────────────────────────────────────────┘
                            │ text deltas → SSE event "delta"
                            │ tool_use    → SSE event "tool_use"
                            ▼
                  search_kb(query, top_k):
                    1. embedQuery() → Voyage voyage-4-large (1024-d)
                    2. supabase.rpc('search_kb', ...)
                         · BM25 over kb_chunks.text_tsv
                         · cosine over kb_chunks.embedding
                         · Reciprocal Rank Fusion → top_k rows
                    3. fetch document titles for citations
                    4. → tool_result back to model + audit row
                            │
                            ▼
                  Model emits final assistant text → "delta" SSE
                            │
                            ▼
                  SSE "sources" (clickable doc chips)
                  SSE "done"    (stop_reason + token usage)

 Audit (best-effort, parallel):
   conversations  ← started/updated
   messages       ← user / assistant / tool turns, with tool_chunks[] refs
```

## 3. Per-machine KB ingestion pipeline

Triggered by the admin UI (drag-drop) or the local CLI (`npm run ingest`).

```
 PDF upload (admin)            scripts/ingest.ts (local)
        │                              │
        └──────────────┬───────────────┘
                       ▼
            POST /api/admin/ingest        [src/lib/ingestion.ts]
                       │
                       ├─ upsert machine_kb (machine_id, account_id, name)
                       ├─ insert kb_documents { status: 'uploaded' }
                       ├─ upload original → Supabase Storage 'pdfs/<machine>/<doc>.pdf'
                       │
                       ├─ extractPdfText()    [src/lib/pdfText.ts]
                       │     • try pdf-parse (text-native PDFs)
                       │     • fall back to Claude vision OCR for scans
                       │     → kb_documents.extraction_source = 'pdf-parse' | 'claude-ocr'
                       │
                       ├─ chunkText() — recursive splitter, ~3500 chars w/ ~400 overlap
                       │
                       ├─ embedDocuments() → Voyage batch → vector(1024) per chunk
                       │
                       ├─ insert kb_chunks { text, text_tsv (auto), embedding, page_from/to }
                       │
                       ├─ regenerateSuggestedQuestions()  → machine_kb.suggested_questions
                       │
                       └─ kb_documents.status = 'ready'   (now visible in chat manifest)
```

## 4. Auth & access summary

| Surface                 | Who                  | How they authenticate                              |
|-------------------------|----------------------|----------------------------------------------------|
| `/` (chat)              | Operator             | Optipeople bearer (login screen)                   |
| `/m/<machineId>` (QR)   | Operator at machine  | `X-QR-Token` from signed QR sticker                |
| `/admin/*`              | Super-admin          | Optipeople bearer + `permissionName=SuperAdministrator` (checked in every `/api/admin/*` route via `requireSuperAdmin`) |
| `/escalation/[token]`   | Service tech         | Signed share token (no Optipeople login required)  |

## 5. Escalation flow

```
 Operator: "Tilkald service" button
        │
        ▼
 POST /api/chat/escalate
        │
        ├─ snapshot conversation → escalations.context_blob (immutable)
        ├─ mint shareToken (32-char base64url, 30-day TTL)
        ├─ resolve channel from accounts_escalation_config:
        │     phone   → returns tel: link to client
        │     email   → Resend → service tech inbox (with shareUrl)
        │     webhook → POST customer ticketing endpoint (shareUrl in payload)
        └─ conversations.resolution = 'escalated'
                          │
                          ▼
            Tech opens shareUrl → /escalation/[token]
                          │
                          ▼
            GET /api/escalations/[token]
              renders the snapshotted transcript (read-only, no auth)
```

## 6. Data model (current)

Tables managed via [supabase/migrations/](../supabase/migrations/):

```
machine_kb                kb_documents              kb_chunks
─────────────             ──────────────            ──────────────
machine_id  PK            id          PK            id              PK
account_id                machine_id  FK→           document_id     FK→ kb_documents
display_name              account_id                machine_id      (denormalised)
system_prompt_extra       title                     ordinal
active_embedding_model    summary                   page_from / page_to
suggested_questions[]     source_type               text
qr_token                  storage_path              text_tsv        (generated)
                          status                    embedding       vector(1024)
                          extraction_source         embedding_model
                          folder_path
                          page_count / byte_size
                          progress / progress_msg
                          updated_at

conversations             messages                  feedback              escalations
─────────────             ─────────                 ────────              ────────────
id           PK           id              PK        id           PK       id              PK
machine_id                conversation_id FK        conversation_id FK    conversation_id FK
account_id                role                      resolved              channel
user_id / email / name    content                   solution_text         target
entry_mode (qr|manual)    tool_name / tool_input    promoted_doc_id FK    context_blob (snapshot)
resolution                tool_chunks[]  →kb_chunks created_at            share_token
started_at / ended_at     tokens_in/out, cache_hit                        created_at
                          created_at

accounts_escalation_config         (per-account: channel + target + webhook secret)
```

## 7. External dependencies at a glance

| Service       | What we call it for                               | Where in code                          |
|---------------|---------------------------------------------------|----------------------------------------|
| Optipeople    | Identity, accounts, machines, role check          | [src/lib/auth.ts](../src/lib/auth.ts), [src/auth/currentUserApi.ts](../src/auth/currentUserApi.ts) |
| Anthropic     | Chat (Claude Haiku 4.5) + vision-OCR fallback     | [src/app/api/chat/route.ts](../src/app/api/chat/route.ts), [src/lib/pdfText.ts](../src/lib/pdfText.ts) |
| Voyage AI     | Embeddings (`voyage-4-large`, 1024-d)             | [src/lib/voyage.ts](../src/lib/voyage.ts) |
| Supabase      | Postgres (pgvector + RPC `search_kb`) + Storage   | [src/lib/supabase.ts](../src/lib/supabase.ts), [supabase/migrations/](../supabase/migrations/) |
| Resend        | Outbound transactional email for escalations      | [src/lib/email.ts](../src/lib/email.ts) |
| Customer webhooks | Escalation hand-off into customer ticketing   | [src/lib/escalation.ts](../src/lib/escalation.ts) |
