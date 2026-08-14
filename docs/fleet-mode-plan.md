# Fleet mode — implementation plan

**Goal:** let a logged-in user chat across *all* machines on their account ("fleet scope"),
alongside the existing per-machine chat. Written 2026-08-13.

> **Status (2026-08-13):** Phases 0–2 are implemented (migration
> `20260813150000_fleet_mode.sql`, server fleet path, client UI) and
> awaiting dev review. Phase 3 (admin visibility for fleet
> conversations, dynamic fleet starters, grouped knowledge drawer) and
> Phase 4 (voice) are not started. Escalation and attachments are
> intentionally hidden in fleet scope for v1.

## Scope model

A conversation has exactly one scope, fixed at creation:

- `machine` — today's behavior, unchanged. QR sessions are *always* machine-scoped.
- `fleet` — account-wide. KB search spans every onboarded machine on the account,
  and the account-wide Optipeople MCP tools (`get_machines_basic_info`,
  `get_factories_data`, …) are unlocked instead of forbidden.

Fleet is an explicit choice on the machine picker ("All machines"), not a replacement.
The operator-at-the-machine experience (focused prompt, QR pinning) stays exactly as is.

## Guardrails (non-negotiable while implementing)

1. **QR stays machine-pinned.** The server already forces the token's machine
   (`route.ts:842-847`); a `scope: "fleet"` field on a QR request must be ignored.
2. **Machine-mode prompt stays byte-identical.** The 1h prompt cache is keyed on the
   system block; fleet mode gets its *own* prompt builder and its own tool array —
   never touch the machine-mode strings.
3. **Voice is out of scope for v1.** The voice path is a parallel copy of the whole
   pipeline (`src/app/api/voice/**`, `src/lib/searchKb.ts`); hide the voice button in
   fleet chat until Phase 4.

---

## Phase 0 — schema groundwork (no behavior change)

One migration, `supabase/migrations/<ts>_fleet_mode.sql`:

```sql
-- conversations: allow fleet-scoped rows
alter table conversations alter column machine_id drop not null;
alter table conversations add column scope text not null default 'machine'
  check (scope in ('machine', 'fleet'));
alter table conversations add constraint conversations_scope_machine_ck
  check ((scope = 'machine') = (machine_id is not null));
create index conversations_account_scope_idx on conversations (account_id, scope);

-- multi-machine hybrid search; single-machine search_kb stays untouched
-- (the voice path and machine-mode chat keep using it)
create or replace function search_kb_multi(
  p_machine_ids     text[],
  p_query_embedding vector(1024),
  p_query_text      text,
  p_embedding_model text default 'voyage-4-large',
  p_match_count     int  default 6,
  p_candidates      int  default 30,
  p_rrf_k           int  default 60
)
returns table (
  chunk_id uuid, document_id uuid, machine_id text,
  ordinal int, page_from int, page_to int, text text, rrf_score float
)
-- body identical to search_kb except:
--   where machine_id = any(p_machine_ids)   (both CTEs)
--   + c.machine_id in the final select      (for attribution)
```

No changes to `kb_chunks` / `kb_documents`: the server resolves account → machine set
from `machine_kb` (which already has `account_id`) and passes the array. Avoids
backfilling a denormalized `account_id` column.

Also check `usage_events` — if `machine_id` is `not null` there, relax it the same way.

## Phase 1 — chat API fleet path (`src/app/api/chat/route.ts` + libs)

**Request shape.** Add `scope?: "machine" | "fleet"` to `ChatRequest` (`route.ts:197`).
Validation (`route.ts:857-868`): fleet ⇒ `machineId` not required (and ignored);
machine ⇒ required as today. QR ⇒ scope forced to `machine`.

**Fleet machine set.** New helper (suggest `src/lib/fleet.ts`):
`getFleetMachines(accountId)` → `machine_kb` rows for the account:
`{ machineId, displayName, portalMachineId, docCount }`. This is the single source for
the prompt roster, the search array, and id validation on tool calls.

**Tool contracts.** Machine mode keeps `TOOLS` as-is (`route.ts:177`). Fleet mode gets
`FLEET_TOOLS`:

- `search_kb` — same shape plus optional `machine_id` ("omit to search every machine").
  Executes `search_kb_multi` with either the full fleet array or `[machine_id]`.
  Accept *either* the internal id or the portal id and normalize server-side against
  the fleet set — two id spaces confuse models.
- `list_documents` — gains required `machine_id` (fleet doc manifests are not in the
  prompt; see below).
- No `list_machines` tool — the roster lives in the system prompt instead (cheaper,
  cache-friendly, no extra round trip).

**Dispatcher.** Change `executeTool(name, input, machineId)` (`route.ts:761`) to take a
scope union:

```ts
type ToolScope =
  | { kind: "machine"; machineId: string }
  | { kind: "fleet"; machines: FleetMachine[] };
```

**Attribution.** `DocHit`/`ImageHit` (`route.ts:478-498`) gain optional
`machineId`/`machineName`, threaded from `search_kb_multi`'s new `machine_id` column
into the SSE `sources` event so the client can badge chips per machine.

**Fleet system prompt.** New `buildFleetSystemPrompt(accountId, machines, hasMcp)`
next to `buildSystemPrompt` (`route.ts:388`). Shares `SYSTEM_PREAMBLE` and the
account-rules section; replaces the two inverted blocks:

- *Fleet identity* (replaces `machineIdentity`, `route.ts:443-447`): roster of
  machines — display name, machine_id, portal_machine_id (when linked), doc count.
  "The user may ask about any machine or all of them. When a question is ambiguous
  about which machine, ask — or answer fleet-wide when that is clearly the intent."
- *MCP guidance* (replaces `route.ts:453-461`): account-wide tools are now the
  default for fleet-level questions; per-machine MCP tools take the roster's
  portal ids; machines without a portal id are KB-only.
- **Doc manifests stay out of the fleet prompt** — only per-machine doc counts in the
  roster. Keeps the prompt small and the 1h cache economical; the model calls
  `list_documents(machine_id)` when it needs titles.

**Persistence.** `createConversation` (`src/lib/conversations.ts:13`): `machineId`
nullable + `scope`. `validateConversation` (`:44`): match on
`(scope, account_id, user_id)` for fleet rows instead of `machine_id` equality —
callers at `route.ts:923-941` pass the resolved scope.

**Attachments.** Upload + per-turn re-signing are machine-keyed
(`route.ts:247-292`, `:966-976`, upload route). For fleet conversations key
attachments by `account_id` (nullable `machine_id` on `conversation_attachments`,
mirror the conversations migration). Verify the exact validation shape in the upload
route during implementation.

**Metering.** `route.ts:1123-1132` — pass `machineId: null` (or the scope) for fleet
turns; see Phase 0 schema note.

## Phase 2 — client

**State.** `src/auth/storage.ts`: new `fleet_mode` localStorage key + helpers;
`clearCurrentAccount()` cascade (`storage.ts:66-70`) also clears it.
`AuthContext` (`src/auth/AuthContext.tsx`): `fleetSelected`, `selectFleet()`,
`clearSelectedMachine()` also clears the fleet flag.

**Gate** (`src/app/page.tsx:373`):

```
currentAccount && !currentMachine && !fleetSelected && !machinesForbidden
  → MachineSelectScreen
```

`ChatApp` already accepts `machine: null` (page.tsx:382-384, the `machinesForbidden`
path) — add a `scope` prop rather than overloading null. **Verify during
implementation** how the `machinesForbidden` path populates `machineId` today, since
the server 400s without it.

**Picker** (`src/components/MachineSelectScreen.tsx`): "All machines" entry above the
list, shown when `machines.length > 1`. ⚠️ Per CLAUDE.md design rules: needs a Figma
reference before styling — do not improvise the card. Same for the fleet chat header
and the machine badge on source chips.

**UserMenu** (`src/components/UserMenu.tsx:219-238`): the switch-machine handler
already funnels to the picker; just also clear the fleet flag. Show the item when
`machines.length > 1 || fleetSelected`.

**ChatApp changes** (`src/app/page.tsx`):
- Request body (`:975-984`): send `scope`; omit `machineId` in fleet.
- State reset (`:552-573`): key on `(scope, machine?.id)`.
- Header shows "All machines — {account.name}" in fleet.
- Source chips: machine name badge when `sources` carry `machineName`.
- Hide in fleet for v1: knowledge drawer (`:1310`), voice (`:1798`),
  machine suggestions fetch (`:589`) → replace with static localized fleet starters.
- Escalation (`:884`): make machine optional; targets are already account-level.

**i18n:** en + da strings for every new label (picker entry, header, badges, starters).

## Phase 3 — polish

- **Admin visibility:** fleet conversations have `machine_id null`, so they are
  invisible to `/api/admin/machines/[id]/conversations`. Add an account-level
  conversations endpoint + a "Fleet" tab/section in the admin UI.
- Fleet suggestions endpoint (dynamic starters from fleet MCP data) replacing the
  static list.
- Knowledge drawer in fleet mode: docs grouped by machine
  (needs `/api/accounts/[id]/documents`).

## Phase 4 — voice fleet mode (optional, later)

Mirror Phase 1 in `src/app/api/voice/realtime/session/route.ts`,
`voice/realtime/tool/route.ts`, and `src/lib/searchKb.ts` (switch to
`search_kb_multi`). Until then voice stays machine-only.

## Test matrix (manual, before merge of each phase)

| Case | Expect |
|---|---|
| Machine chat, bearer | unchanged; prompt-cache hits (`cache_hit` in messages rows) |
| Machine chat, QR | unchanged; `scope:"fleet"` in body is ignored, machine forced |
| Fleet chat, first turn | `conversations` row: `scope='fleet'`, `machine_id null` |
| Fleet follow-up turn | `validateConversation` passes without machineId |
| "Compare uptime on X vs Y" | account-wide/per-machine MCP calls with roster portal ids |
| "Which machine has docs about Z?" | cross-machine `search_kb`, chips badged per machine |
| Switch fleet → machine → fleet | chat state resets each switch; no cross-scope bleed |
| Wizard-created (local) machine in fleet | included in KB search, excluded from MCP guidance |
| Fleet conv with attachment | upload + re-signing works without machine key |

## Open decisions (recommendations inline)

1. **Design references needed** (blocking Phase 2 styling, per project design rules):
   picker "All machines" entry, fleet chat header, machine badge on source chips.
   Recommend requesting Figma; build Phases 0–1 meanwhile.
2. **Who gets fleet mode:** recommend any bearer user whose account has ≥ 2 machines —
   no role gate. QR users are excluded inherently.
3. **Rollout flag:** optionally gate the server's acceptance of `scope:"fleet"` behind
   an env flag for staged rollout. Recommend yes, it's one line.
