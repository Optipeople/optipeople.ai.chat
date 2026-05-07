# OptiAI — Wood Machine Operator Assistant

Next.js app that gives wood-industry machine operators fast answers from their machine's manuals, instead of searching PDFs or waiting for support.

See [docs/architecture.md](docs/architecture.md) for the product architecture and roadmap.

## Stack

- **Framework**: Next.js 16 (App Router) + React 19 + TypeScript
- **Styling**: Tailwind 4 + shadcn-style components
- **AI**: Claude Haiku 4.5 via `@anthropic-ai/sdk`, with prompt caching on a 1h TTL
- **Auth**: Optipeople OAuth2 (proxied through `/auth-api/[...]`)
- **Data** (Phase 1+): Supabase (Postgres + Storage + pgvector)
- **Embeddings** (Phase 1+): Voyage AI `voyage-4-large` @ 1024d
- **Knowledge** (interim): PDFs in `knowledgebase/` extracted into `data/knowledge.json` and served as a cached system prompt

## First-time setup

```bash
# 1. Install deps
npm install

# 2. Configure env
cp .env.example .env.local
# → edit .env.local, set ANTHROPIC_API_KEY (and Supabase / Voyage / Optipeople keys when needed)

# 3. Extract PDF text (one-time; regenerate when PDFs change)
npm run extract
```

## Run

```bash
npm run dev
# → http://localhost:3000
```

## Project layout

```
src/
  app/                     Next App Router
    api/chat/route.ts      Streaming chat endpoint (Anthropic + cached KB)
    auth-api/[...path]/    Catch-all proxy → Optipeople auth API
    layout.tsx             Root layout, AuthProvider
    page.tsx               Operator entry: login → account → machine → chat
    globals.css            Brand tokens (Tailwind 4 @theme)
  auth/                    Auth state + Optipeople API clients
  components/              Screens, UserMenu, logo, ui/ (button, textarea, markdown)
  lib/utils.ts             cn() helper

scripts/extract-pdfs.mjs   Interim KB extraction (replaced by Phase 1 ingestion)
data/knowledge.json        Generated, gitignored
knowledgebase/             Source PDFs

supabase/
  config.toml
  migrations/              Phase 1 schema (per-machine KB, conversations, messages, …)

docs/
  architecture.md          Product architecture and phased roadmap
  overview.md              Product overview
```

## Notes

- `data/knowledge.json` is gitignored — it's generated from `knowledgebase/`.
- `.env.local` is gitignored. The committed `.env.example` is a placeholder template.
- The chat route uses `cache_control: { ttl: "1h" }` so the KB system prompt is cached. First request/hour pays full price; the rest are cheap.
