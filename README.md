# Opti Assist Chat

**The AI assistant that lives at the machine.**

When a CNC, edge bander, or panel saw throws a fault, the operator has minutes — not hours — to get back into production. Opti Assist Chat puts an expert in the operator's pocket: a chat interface, scoped to the exact machine they're standing in front of, backed by that machine's manuals, drawings, error codes, and accumulated tribal knowledge.

Ask in plain language. Get an answer in seconds. Escalate to a human with full context if the AI can't close it out.

Built as an extension to the [Optipeople](https://optipeople.dk) MES platform.

---

## Why it matters

- **Less downtime.** Operators resolve issues at the machine instead of digging through PDFs or waiting on the OEM hotline.
- **Per-machine context.** The assistant knows *which* machine — it doesn't answer from a generic manual dump.
- **Auditable.** Every answer is traceable to a knowledge base version, a conversation, and an operator.
- **Knowledge that compounds.** Operator-validated fixes flow back into the knowledge base instead of dying in one senior tech's head.
- **Shop-floor UX.** QR-code entry, one-tap chat, voice and image input, multilingual (English & Danish today).

## What's inside

- Operator chat with streaming answers, attachments, live transcription, and SMS escalation
- Per-machine knowledge base with agentic retrieval (no naive prompt stuffing)
- Admin console for account, machine, knowledge, and MCP-server management
- Account-scoped MCP integration so customers can plug in their own tools
- Realtime voice mode and image ingestion for fault photos
- Consent flow, legal docs, and i18n out of the box

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4 · Supabase (Postgres + Storage + pgvector) · Claude (Anthropic) + OpenAI · Voyage embeddings · Twilio · Resend · Vercel.

Retrieval is hybrid BM25 (`tsvector`) + vector (HNSW), fused with Reciprocal Rank Fusion in a Postgres function and driven by Claude tool use.

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in ANTHROPIC, VOYAGE, SUPABASE, OPTIPEOPLE keys
npx supabase link --project-ref <your-project-ref>
npx supabase db push
npm run dev                  # http://localhost:3000
```

Ingest a machine's manuals:

```bash
npm run ingest -- \
  --machine-id <uuid> \
  --account-id <uuid> \
  --machine-name "<display name>" \
  knowledgebase/
```

Hit `GET /api/health` to confirm Anthropic, Voyage, Optipeople, and Supabase are all reachable.

See [docs/architecture.md](docs/architecture.md) and [docs/overview.md](docs/overview.md) for the deeper picture.

---

## License — source available, **not** open source

This repository is **source available** under a strict proprietary copyright license. The code is published so customers, partners, and auditors can inspect it — not so it can be reused.

**You may not**, without prior written permission from Optipeople ApS:

- Use this code, in whole or in part, in any other product or service
- Distribute, sublicense, sell, or publish derivative works
- Self-host this software outside an existing Optipeople agreement
- Remove or alter copyright, license, or attribution notices

All rights reserved. © Optipeople ApS. The absence of an OSI-approved `LICENSE` file does **not** imply an open-source license — the default of "all rights reserved" applies.

For commercial licensing, partnership, or integration enquiries: **mpg@optipeople.dk**.

---

Optipeople ApS · [optipeople.dk](https://optipeople.dk) · support@optipeople.dk
