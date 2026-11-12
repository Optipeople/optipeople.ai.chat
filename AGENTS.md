# Shared UI lives in @optipeople/ui

Base components, design tokens and reusable blocks come from the package `@optipeople/ui` (repo `Optipeople/optipeople.ui`, usually checked out next to this repo). Do not create or edit a local copy of a shared component, and do not add design tokens to `globals.css`.

- To fix or change a shared component, or to add a new one: do it in `optipeople.ui`, bump its version and push (that publishes it), then update `@optipeople/ui` here.
- A component that only this app will ever need can live here. If a second app could use it, it belongs in the package under `src/blocks`.
- Never patch `node_modules`.
