# TODO

## Pre-production

- [ ] **Replace Vite dev proxy for `/auth-api/*` with a real server-side proxy.**
  The Vite dev server proxy is dev-only. Once deployed, `/auth-api/*` will not exist unless `server/index.js` (or whatever serves the app in prod) proxies it to the auth backend. Wire this up before the first prod deploy.
