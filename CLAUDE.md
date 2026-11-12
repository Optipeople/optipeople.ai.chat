@AGENTS.md

# Project rules

## Design fidelity

When given a design (e.g. Figma drawings, mockups, screenshots), implement it **EXACTLY** as shown — not an approximation, not an inspired interpretation. Match spacing, colors, typography, sizing, layout, and component structure pixel-for-pixel. If something in the design is unclear or appears to conflict with the codebase, ask before deviating. Do not improvise your own variation.

## Never invent UI components

Do **NOT** invent new button styles, form controls, cards, modals, or any other UI component on the fly. Before writing custom Tailwind classes for something that looks like a reusable component:

1. Check the shared package `@optipeople/ui` (base components) and `@optipeople/ui/blocks` for an existing primitive (e.g. `Button` with its `primary` / `secondary` / `destructive` variants, `buttonClasses()` for `<Link>`). Its source is the repo `Optipeople/optipeople.ui`, usually checked out next to this one.
2. If an existing primitive fits, use it.
3. If nothing fits the context (e.g. need a button on a dark surface but only light-surface variants exist), **stop and ask**: request a Figma reference or explicit direction before either extending the primitive or styling something custom. Never silently roll your own.

This applies even when the styling seems trivial. A one-off "just this once" button is how the design system rots.

A new shared component, or a fix to one, goes into the `optipeople.ui` repo, not into a local copy here. Bump its version, push (that publishes it), then update `@optipeople/ui` in this app.
