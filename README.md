# OptiAI — Wood Machine Operator Assistant

MVP chat app that gives wood-industry machine operators fast answers from their machine's manuals, instead of searching PDFs or waiting for support.

## Stack

- **Client**: Vite + React + Tailwind 4 + shadcn/ui
- **Server**: Node + Express
- **AI**: Claude Sonnet 4.6 via `@anthropic-ai/sdk`
- **Knowledge**: PDFs in `knowledgebase/` extracted once into `server/knowledge.json`, served as a cached system prompt (prompt caching → ~90% cost reduction on repeat requests)

## First-time setup

```bash
# 1. Install deps
cd server && npm install
cd ../client && npm install

# 2. Configure the server env
cd ../server
cp .env.example .env
# → edit .env, paste your ANTHROPIC_API_KEY

# 3. Extract PDF text (one-time; regenerate when PDFs change)
npm run extract
```

## Run

In two terminals:

```bash
# Terminal 1 — server (http://localhost:3001)
cd server && npm run dev

# Terminal 2 — client (http://localhost:5173)
cd client && npm run dev
```

## Adding more machines / manuals

Drop PDFs into `knowledgebase/` and re-run `npm run extract` in `server/`.

## Notes

- The extracted knowledge base (`server/knowledge.json`) is gitignored — it's generated.
- The system prompt includes a `cache_control` breakpoint so the large manual context is cached for 1 hour. First request/hour pays full price; the rest are cheap.
