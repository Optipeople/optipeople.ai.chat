# OptiAI — Wood Machine Operator Assistant

Next.js app that gives wood-industry machine operators fast answers from their machine's manuals, instead of searching PDFs or waiting for support.

See [docs/architecture.md](docs/architecture.md) for the product architecture and roadmap.

## Stack

- **Framework**: Next.js 16 (App Router) + React 19 + TypeScript
- **Styling**: Tailwind 4 + shadcn-style components
- **AI**: Claude Haiku 4.5 via `@anthropic-ai/sdk`, agentic retrieval with tool use
- **Auth**: Optipeople OAuth2 (proxied through `/auth-api/[...]`)
- **Data**: Supabase (Postgres + Storage + pgvector)
- **Embeddings**: Voyage AI `voyage-4-large` @ 1024d
- **Retrieval**: Hybrid BM25 (`tsvector`) + vector (HNSW) search, fused with Reciprocal Rank Fusion in a Postgres function

## First-time setup

```bash
# 1. Install deps
npm install

# 2. Configure env
cp .env.example .env.local
# → edit .env.local with ANTHROPIC_API_KEY, VOYAGE_API_KEY, SUPABASE_URL,
#   SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_*, OPTIPEOPLE_API_TARGET

# 3. Apply Supabase schema
npx supabase link --project-ref <your-project-ref>
npx supabase db push

# 4. Ingest manuals for a machine (uploads to Supabase Storage, embeds via Voyage)
npm run ingest -- \
  --machine-id <uuid> \
  --account-id <uuid> \
  --machine-name "<display name>" \
  knowledgebase/
```

## Run

```bash
npm run dev
# → http://localhost:3000
```

Hit `GET /api/health` to confirm Anthropic / Voyage / Optipeople / Supabase are all reachable.

## Project layout

```
src/
  app/                     Next App Router
    api/chat/route.ts      Agentic retrieval chat (Anthropic tool use → Supabase)
    api/health/route.ts    End-to-end readiness probe
    auth-api/[...path]/    Catch-all proxy → Optipeople auth API
    layout.tsx             Root layout, AuthProvider
    page.tsx               Operator entry: login → account → machine → chat
    globals.css            Brand tokens (Tailwind 4 @theme)
  auth/                    Auth state + Optipeople API clients
  components/              Screens, UserMenu, logo, ui/ (button, textarea, markdown)
  lib/
    supabase.ts            Server-side Supabase client (service role)
    voyage.ts              Voyage embeddings (document + query, with retry)
    utils.ts               cn() helper

scripts/
  ingest.ts                Per-machine ingestion CLI (PDF → chunks → embeddings)

knowledgebase/             Source PDFs (currently the Felder set)

supabase/
  config.toml
  migrations/              Phase 1 schema + search_kb hybrid retrieval function

docs/
  architecture.md          Product architecture and phased roadmap
  overview.md              Product overview
```

## Notes

- `.env.local` is gitignored. The committed `.env.example` is a placeholder template.
- The chat system prompt (persona + per-machine document manifest + tool schemas) is cached with `cache_control: { ttl: "1h" }`. First request per hour per machine pays full price; subsequent ones are cheap.
- Re-running `npm run ingest -- --reset ...` wipes existing documents/chunks for the machine and re-ingests cleanly. Useful while iterating on the chunker.
