# Pre-printed QR stickers: plan

## Problem

Today every machine gets its QR code one at a time: open the machine in admin,
generate a token (`machine_kb.qr_token`), open the print page, download an A6
PNG, print it. For 50 to 100 machines that is slow, and because the token only
exists after the machine is set up, stickers cannot be ordered in advance from a
print shop.

## Current setup (as reviewed)

- `machine_kb.qr_token` / `qr_token_created_at`: one random token per machine
  (migration `20260510170000_machine_qr_token.sql`). The token is the
  authorization: anyone scanning lands in the chat without logging in.
- `POST/DELETE /api/admin/machines/[id]/qr` mints or revokes it.
- Sticker URL is `/?qr=<token>`. `src/app/page.tsx` resolves it via
  `GET /api/qr/resolve`, stores it in sessionStorage (`src/auth/qrStorage.ts`)
  and strips it from the URL.
- Every operator route authorises QR sessions through `resolveQrToken()` in
  `src/lib/qrAuth.ts`.
- `src/admin/qrSticker.ts` renders the branded A6 sticker on canvas.
  `QrPrintView` shows and downloads it, one machine at a time.

## Solution

Two features that share one idea: **the sticker URL is a stable indirection,
the database decides where it points.**

### 1. Sticker pool (pre-printed stickers)

- A super admin creates a **batch** of N stickers (e.g. 500), optionally
  reserved for one customer account. Each sticker gets:
  - a random **token** (16 bytes, base64url, 22 chars) in the URL
    `https://<app>/q/<token>`;
  - a short human **code**, 8 chars from `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`,
    shown as `7F3K-9PQX` and printed under the QR. Admins use it to link by
    hand. It never grants chat access by itself.
- The batch is downloaded as a **print PDF** (one sticker per page, page sized to the sticker at
  105 x 131 mm, same
  brand design, "Opti Assist" in place of the machine name, code under the QR)
  and a **CSV** (`code,url`) for print shops that do variable data printing.
- **Scanning an unlinked sticker** opens `/q/<token>`:
  - not logged in: "This sticker is not activated yet", plus "Log in to
    activate" for admins;
  - logged in as admin: a searchable list of the admin's machines. Tap one and
    the sticker is linked. About ten seconds per machine, done on the floor.
  - logged in, not admin: "Ask your administrator to activate it".
- **Scanning a linked sticker** goes straight into the chat via the existing
  `/?qr=<token>` flow. Nothing in the chat stack changes.
- A machine can have several stickers (front and back). The per-machine token
  keeps working as before.
- **Unlink** frees a sticker for another machine. **Retire** kills a damaged or
  lost sticker for good. **Reassign** moves a linked sticker (asks first).

### 2. Bulk print for existing machines

In the machine list, select machines and download one PDF with a named sticker
per machine. Machines without a token get one minted. Fixes the "slow" half for
customers who print their own.

## Data model

Migration `supabase/migrations/20261102120000_qr_sticker_pool.sql`:

```sql
create table qr_sticker_batches (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,
  account_id  text,               -- reserved for this account, or null = global pool
  created_by  text,
  created_at  timestamptz not null default now()
);

create table qr_stickers (
  id          uuid primary key default gen_random_uuid(),
  batch_id    uuid not null references qr_sticker_batches(id) on delete cascade,
  code        text not null unique,
  token       text not null unique,
  account_id  text,               -- reserved or bound account
  machine_id  text references machine_kb(machine_id) on delete set null,
  linked_at   timestamptz,
  linked_by   text,
  retired_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index on qr_stickers (machine_id);
create index on qr_stickers (batch_id);
alter table qr_sticker_batches enable row level security;
alter table qr_stickers enable row level security;
```

Status is derived: `retired_at` set → retired; `machine_id` set → linked; else
unclaimed. RLS on with no policies: only the service role touches these tables,
like the rest of the app.

## Auth and scoping

- Batches: super admins only (create, list, download).
- Linking: any admin. Account admins may link a sticker only if its
  `account_id` is null or their own, and only to their own machines. On first
  link `account_id` is set to the machine's account, so the sticker stays with
  that customer after an unlink.
- Unlink / retire: admin with access to the sticker's account.
- `resolveQrToken()` checks `machine_kb.qr_token` first, then
  `qr_stickers.token` (linked, not retired). Same `QrSession` shape, so every
  operator route accepts sticker tokens with no other change.

## API (contract in `src/lib/qrStickerTypes.ts`)

| Route | Who | What |
|---|---|---|
| `GET /api/qr/stickers/[token]` | public | status of a sticker for the scan page |
| `GET /api/admin/qr-stickers/batches` | super | list batches with counts |
| `POST /api/admin/qr-stickers/batches` | super | create batch, returns stickers |
| `GET /api/admin/qr-stickers/batches/[id]` | super | batch + stickers (for PDF/CSV) |
| `GET /api/admin/qr-stickers/lookup?code=` / `?token=` | admin | find one sticker |
| `POST /api/admin/qr-stickers/link` | admin | link by token or code |
| `PATCH /api/admin/qr-stickers/[id]` | admin | unlink / retire |
| `GET /api/admin/machines/[id]/qr-stickers` | admin | stickers on a machine |
| `POST /api/admin/machines/qr-bulk` | admin | tokens for bulk named print |

## UI

- `/q/[token]`: scan landing (redirect, claim flow, or status message).
- `/admin/qr-stickers` (super admins, new admin tab "QR stickers"): batches,
  create dialog, download PDF / CSV, sticker list per batch with status.
- Machine detail QR card: list of linked stickers (code, date, unlink) and a
  "Link sticker by code" field.
- Machine list: select machines, "Print QR stickers" → PDF.

## Sticker URL base

Pre-printed stickers live for years, so the base URL must not follow whatever
host the admin happens to use. `NEXT_PUBLIC_QR_BASE_URL`, falling back to
`window.location.origin`.

## Rollout

1. `npx supabase db push` (additive migration, no existing data touched).
2. Deploy. Existing stickers keep working unchanged.
3. Create a small test batch, print, link, scan, before ordering in bulk.
