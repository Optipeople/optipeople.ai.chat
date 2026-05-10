-- Per-machine QR access token. The token IS the authorization — anyone
-- with a sticker scan lands directly in the chat for that machine,
-- skipping the Optipeople login flow. One token per machine; rotating
-- means generating a new value (the column is unique). Setting both
-- columns to NULL revokes access entirely.

alter table machine_kb
  add column qr_token            text unique,
  add column qr_token_created_at timestamptz;
