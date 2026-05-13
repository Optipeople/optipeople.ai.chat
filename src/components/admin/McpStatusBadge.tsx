// Reusable MCP status pill. Used both on /admin/mcp (full table)
// and on /admin/machines/[id] (single badge in the meta-info card).
// Kept visually identical across surfaces so the admin doesn't
// double-check which page says what.

import type { McpStatus } from "@/admin/mcpAdminApi";

const STATUS_LABEL: Record<McpStatus, string> = {
  unconfigured: "Not connected",
  pending_auth: "Auth started",
  authorized: "Connected",
  expired: "Token expired",
  error: "Error",
};

export function McpStatusBadge({ status }: { status: McpStatus }) {
  const bg =
    status === "authorized"
      ? "bg-[var(--ds-tag-green-light)] text-[var(--ds-green-dark)] border-[var(--ds-tag-green-dark)]"
      : status === "error" || status === "expired"
        ? "bg-[var(--ds-tag-red-light)] text-[var(--ds-red-dark)] border-[var(--ds-tag-red-dark)]"
        : status === "pending_auth"
          ? "bg-[var(--ds-tag-amber-light)] text-[var(--ds-amber-dark)] border-[var(--ds-tag-amber-dark)]"
          : "bg-[var(--color-muted)] text-[var(--color-muted-foreground)] border-[var(--color-hairline)]";
  return (
    <span
      className={`inline-flex items-center rounded-[2px] border px-2 py-0.5 text-[12px] font-medium ${bg}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
