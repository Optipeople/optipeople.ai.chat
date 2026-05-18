"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Loader2, Plus, Trash2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { getAccounts, type Account } from "@/auth/accountsApi";
import { getRegisteredSets } from "@/auth/registeredApi";
import {
  deleteMcpConfig,
  listMcpConfigs,
  registerMcpConfig,
  startMcpAuth,
  type McpConfigSummary,
} from "@/admin/mcpAdminApi";
import { McpStatusBadge } from "@/components/admin/McpStatusBadge";

// Status pill lives in McpStatusBadge so machine pages can render
// the same chip without duplicating colors.

function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* ignore — clipboard may be blocked in some browsers */
        }
      }}
      className="inline-flex items-center gap-1 text-[12px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
      aria-label={label ?? "Copy"}
    >
      <Copy className="h-3.5 w-3.5" />
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function McpList() {
  const router = useRouter();
  const params = useSearchParams();
  const callbackStatus = params.get("status");
  const callbackMessage = params.get("message");

  const [configs, setConfigs] = useState<McpConfigSummary[] | null>(null);
  const [redirectUri, setRedirectUri] = useState<string>("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  // Toast-ish banner after the OAuth callback round-trip. Dismissed
  // when the user closes it or navigates away.
  const [banner, setBanner] = useState<{
    kind: "ok" | "error";
    message: string;
  } | null>(null);

  // Used by the dialog/disconnect flows to refetch after a mutation.
  // Returns a Promise so callers can await it.
  const reload = useCallback(
    () =>
      listMcpConfigs()
        .then((body) => {
          setConfigs(body.configs);
          setRedirectUri(body.redirectUri);
          setLoadError(null);
        })
        .catch((err: unknown) => {
          setLoadError(err instanceof Error ? err.message : "Failed to load");
        }),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    listMcpConfigs()
      .then((body) => {
        if (cancelled) return;
        setConfigs(body.configs);
        setRedirectUri(body.redirectUri);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : "Failed to load");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Surface callback result, then strip the query params so a refresh
  // doesn't re-show the banner. Disable the set-state-in-effect rule
  // here: we're translating a one-shot URL signal into UI state, which
  // is exactly the case the rule's docs treat as a legitimate
  // exception.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (callbackStatus === "ok") {
      setBanner({ kind: "ok", message: "Connected to the MCP server." });
    } else if (callbackStatus === "error") {
      setBanner({
        kind: "error",
        message: callbackMessage || "Authorization failed.",
      });
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    if (callbackStatus) {
      router.replace("/admin/mcp");
    }
  }, [callbackStatus, callbackMessage, router]);

  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold tracking-tight text-[var(--color-foreground)] sm:text-[24px]">
            MCP integrations
          </h1>
          <p className="mt-1 text-[13px] text-[var(--color-muted-foreground)] sm:text-[14px]">
            Per-account credentials for the Optipeople MCP server. The chat
            uses these to fetch machine data on behalf of each account.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setAddOpen(true)}
          className="self-start sm:self-auto"
        >
          <Plus className="mr-1.5 h-4 w-4" />
          Add credentials
        </Button>
      </div>

      {banner ? (
        <div
          className={`rounded-[4px] border px-4 py-3 text-[14px] ${
            banner.kind === "ok"
              ? "border-[var(--ds-tag-green-dark)] bg-[var(--ds-tag-green-light)] text-[var(--ds-green-dark)]"
              : "border-[var(--ds-tag-red-dark)] bg-[var(--ds-tag-red-light)] text-[var(--ds-red-dark)]"
          }`}
        >
          <div className="flex items-center justify-between">
            <span>{banner.message}</span>
            <button
              type="button"
              onClick={() => setBanner(null)}
              className="text-current opacity-60 hover:opacity-100"
            >
              ×
            </button>
          </div>
        </div>
      ) : null}

      <div className="rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-3 sm:p-4">
        <div className="text-[12px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
          OAuth redirect URI (used during dynamic client registration)
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2 sm:gap-3">
          <code className="min-w-0 flex-1 break-all text-[13px] text-[var(--color-foreground)]">
            {redirectUri || "—"}
          </code>
          {redirectUri ? <CopyButton value={redirectUri} /> : null}
        </div>
        <p className="mt-2 text-[12px] text-[var(--color-muted-foreground)]">
          Each registration creates a new entry in the Optipeople portal&apos;s
          Client Secrets list — no manual registration needed.
        </p>
      </div>

      {addOpen ? (
        <AddMcpDialog
          existingAccountIds={
            new Set((configs ?? []).map((c) => c.accountId))
          }
          onClose={() => setAddOpen(false)}
          onSaved={async () => {
            setAddOpen(false);
            await reload();
          }}
        />
      ) : null}

      {loadError ? (
        <div className="rounded-[4px] border border-[var(--ds-tag-red-dark)] bg-[var(--ds-tag-red-light)] p-6 text-[14px] text-[var(--ds-red-dark)]">
          {loadError}
        </div>
      ) : configs === null ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--color-muted-foreground)]" />
        </div>
      ) : configs.length === 0 ? (
        <div className="rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-10 text-center text-[14px] text-[var(--color-muted-foreground)]">
          No accounts have MCP credentials yet. Click <strong>Add credentials</strong> to wire one up.
        </div>
      ) : (
        <McpTable configs={configs} onReload={reload} />
      )}
    </div>
  );
}

function McpTable({
  configs,
  onReload,
}: {
  configs: McpConfigSummary[];
  onReload: () => Promise<void>;
}) {
  return (
    <>
      {/* Mobile cards */}
      <div className="flex flex-col gap-2 sm:hidden">
        {configs.map((c) => (
          <McpCard key={c.accountId} config={c} onReload={onReload} />
        ))}
      </div>

      <div className="hidden overflow-x-auto rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] sm:block">
        <table className="w-full min-w-[640px] text-[14px]">
          <thead className="bg-[var(--color-muted)] text-left text-[12px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
            <tr>
              <th className="px-4 py-3 font-medium">Account / label</th>
              <th className="px-4 py-3 font-medium">Server</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Token expires</th>
              <th className="w-px px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {configs.map((c) => (
              <McpRow key={c.accountId} config={c} onReload={onReload} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function McpCard({
  config,
  onReload,
}: {
  config: McpConfigSummary;
  onReload: () => Promise<void>;
}) {
  const [connecting, setConnecting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  async function startAuth() {
    setRowError(null);
    setConnecting(true);
    try {
      const url = await startMcpAuth(config.accountId);
      window.location.href = url;
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "Failed to start auth");
      setConnecting(false);
    }
  }

  async function disconnect() {
    if (!confirm(`Remove MCP credentials for ${config.label ?? config.accountId}?`))
      return;
    setRowError(null);
    setDeleting(true);
    try {
      await deleteMcpConfig(config.accountId);
      await onReload();
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "Failed to delete");
      setDeleting(false);
    }
  }

  const tokenExpiry = config.accessTokenExpiresAt
    ? new Date(config.accessTokenExpiresAt).toLocaleString()
    : "—";

  return (
    <div className="flex flex-col gap-2 rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-medium text-[var(--color-foreground)]">
            {config.label ?? config.accountId}
          </p>
          <p className="break-all text-[12px] text-[var(--color-muted-foreground)]">
            {config.accountId}
          </p>
        </div>
        <McpStatusBadge status={config.status} />
      </div>
      <p className="break-all text-[12px] text-[var(--color-muted-foreground)]">
        {config.serverUrl}
      </p>
      {config.statusMessage && (
        <p className="text-[12px] text-[var(--ds-red-dark)]">
          {config.statusMessage}
        </p>
      )}
      <p className="text-[12px] text-[var(--color-muted-foreground)]">
        Token expires: {tokenExpiry}
      </p>
      <div className="flex items-center justify-end gap-2">
        <Button size="sm" onClick={startAuth} disabled={connecting || deleting}>
          {connecting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : config.status === "authorized" ? (
            "Reauthorize"
          ) : (
            "Connect"
          )}
        </Button>
        <Button
          size="sm"
          variant="destructive"
          onClick={disconnect}
          disabled={connecting || deleting}
          aria-label="Disconnect"
        >
          {deleting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
      {rowError && (
        <div className="text-[12px] text-[var(--ds-red-dark)]">{rowError}</div>
      )}
    </div>
  );
}

function McpRow({
  config,
  onReload,
}: {
  config: McpConfigSummary;
  onReload: () => Promise<void>;
}) {
  const [connecting, setConnecting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  async function startAuth() {
    setRowError(null);
    setConnecting(true);
    try {
      const url = await startMcpAuth(config.accountId);
      // Full-page redirect — the auth server will bounce back to our
      // callback when the admin approves.
      window.location.href = url;
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "Failed to start auth");
      setConnecting(false);
    }
  }

  async function disconnect() {
    if (!confirm(`Remove MCP credentials for ${config.label ?? config.accountId}?`))
      return;
    setRowError(null);
    setDeleting(true);
    try {
      await deleteMcpConfig(config.accountId);
      await onReload();
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "Failed to delete");
      setDeleting(false);
    }
  }

  const tokenExpiry = config.accessTokenExpiresAt
    ? new Date(config.accessTokenExpiresAt).toLocaleString()
    : "—";

  return (
    <tr className="border-t border-[var(--color-hairline)] align-top">
      <td className="px-4 py-3">
        <div className="font-medium text-[var(--color-foreground)]">
          {config.label ?? config.accountId}
        </div>
        <div className="mt-0.5 text-[12px] text-[var(--color-muted-foreground)]">
          {config.accountId}
        </div>
      </td>
      <td className="px-4 py-3 text-[13px] text-[var(--color-muted-foreground)]">
        {config.serverUrl}
      </td>
      <td className="px-4 py-3">
        <McpStatusBadge status={config.status} />
        {config.statusMessage ? (
          <div className="mt-1 max-w-[28ch] text-[12px] text-[var(--ds-red-dark)]">
            {config.statusMessage}
          </div>
        ) : null}
      </td>
      <td className="px-4 py-3 text-[13px] text-[var(--color-muted-foreground)]">
        {tokenExpiry}
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" onClick={startAuth} disabled={connecting || deleting}>
            {connecting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : config.status === "authorized" ? (
              "Reauthorize"
            ) : (
              "Connect"
            )}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={disconnect}
            disabled={connecting || deleting}
            aria-label="Disconnect"
          >
            {deleting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
        {rowError ? (
          <div className="mt-1 text-[12px] text-[var(--ds-red-dark)]">
            {rowError}
          </div>
        ) : null}
      </td>
    </tr>
  );
}

function AddMcpDialog({
  existingAccountIds,
  onClose,
  onSaved,
}: {
  existingAccountIds: Set<string>;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  // Dynamic Client Registration handles client_id / client_secret for
  // us — the admin only picks which Optipeople account these
  // credentials belong to and the MCP server URL.
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [accountId, setAccountId] = useState("");
  const [serverUrl, setServerUrl] = useState("https://mcp.optipeople.dk");
  const [label, setLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load accounts the SuperAdmin has access to. Reuses the same
  // /api/Account/GetAll call as AddMachineDialog.
  useEffect(() => {
    // Filter to accounts that have at least one machine onboarded into
    // this Opti Assist instance — same intersection the login picker uses
    // (AuthContext.reloadAccounts). Configuring MCP for accounts that
    // have no machines here would be wasted work since no chat session
    // would ever consume those credentials.
    let cancelled = false;
    Promise.all([getAccounts(), getRegisteredSets()])
      .then(([rows, registered]) => {
        if (cancelled) return;
        const filtered = rows
          .filter((a) => registered.accountIds.has(a.id))
          .sort((a, b) => a.name.localeCompare(b.name));
        setAccounts(filtered);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setAccountsError(
          err instanceof Error ? err.message : "Failed to load accounts",
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Esc to close.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !submitting) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  const canSubmit = useMemo(
    () => accountId.trim() && serverUrl.trim() && !submitting,
    [accountId, serverUrl, submitting],
  );

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await registerMcpConfig({
        accountId: accountId.trim(),
        serverUrl: serverUrl.trim(),
        label: label.trim() || null,
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to register");
      setSubmitting(false);
    }
  }

  // Backdrop click — only closes when the click landed directly on
  // the backdrop, not on any descendant of the panel. Avoids the
  // fragile-stopPropagation pattern that closed the dialog on stray
  // re-renders.
  function onBackdropMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget && !submitting) onClose();
  }

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center overflow-y-auto bg-black/40 p-3 sm:p-4"
      onMouseDown={onBackdropMouseDown}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="my-auto w-full max-w-[480px] rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-4 sm:p-6"
      >
        <h2 className="text-[17px] font-semibold tracking-tight text-[var(--color-foreground)] sm:text-[18px]">
          Register MCP client
        </h2>
        <p className="mt-1 text-[13px] text-[var(--color-muted-foreground)]">
          Provision a fresh OAuth client at the MCP server for this account.
          The server issues a Client ID + Secret automatically — same flow
          ChatGPT uses. After registration, click <strong>Connect</strong> on the row to
          run the OAuth consent step.
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <AccountSelect
            accounts={accounts}
            error={accountsError}
            value={accountId}
            onChange={setAccountId}
            existingAccountIds={existingAccountIds}
            disabled={submitting}
          />
          <TextField
            label="MCP server URL"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="https://mcp.optipeople.dk"
            disabled={submitting}
          />
          <TextField
            label="Label (optional)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Shows up in the portal's Client Secrets list"
            disabled={submitting}
          />
        </div>

        {error ? (
          <div className="mt-3 rounded-[2px] border border-[var(--ds-tag-red-dark)] bg-[var(--ds-tag-red-light)] px-3 py-2 text-[13px] text-[var(--ds-red-dark)]">
            {error}
          </div>
        ) : null}

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            type="button"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button size="sm" type="submit" disabled={!canSubmit}>
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Register"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function AccountSelect({
  accounts,
  error,
  value,
  onChange,
  existingAccountIds,
  disabled,
}: {
  accounts: Account[] | null;
  error: string | null;
  value: string;
  onChange: (id: string) => void;
  existingAccountIds: Set<string>;
  disabled: boolean;
}) {
  // Simple native <select>. Good enough for an admin-only screen and
  // dodges the keyboard-focus complexity of the custom popover used
  // by AddMachineDialog.
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[14px] leading-[21px] text-[var(--ds-grey-medium-04)]">
        Account
      </span>
      <select
        className="h-[30px] rounded-[4px] border border-[var(--color-hairline)] bg-white px-2 text-[14px] text-[var(--ds-grey-dark-09)] shadow-[var(--ds-shadow-input)] focus:outline-none focus:ring-2 focus:ring-[var(--ds-green-80)]"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || accounts === null}
      >
        {accounts === null ? (
          <option value="">Loading accounts…</option>
        ) : (
          <>
            <option value="">— Select an account —</option>
            {accounts.map((a) => (
              <option
                key={a.id}
                value={a.id}
                disabled={existingAccountIds.has(a.id)}
              >
                {a.name}
                {existingAccountIds.has(a.id) ? " (already configured)" : ""}
              </option>
            ))}
          </>
        )}
      </select>
      {error ? (
        <span className="text-[12px] text-[var(--ds-red-dark)]">{error}</span>
      ) : null}
    </label>
  );
}
