"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, Trash2 } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { Tooltip } from "@/components/ui/tooltip";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/ui/data-table";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { getAccounts, type Account } from "@/auth/accountsApi";
import {
  deleteMcpConfig,
  listMcpConfigs,
  registerMcpConfig,
  startMcpAuth,
  type McpConfigSummary,
} from "@/admin/mcpAdminApi";
import { Combobox } from "@/components/admin/AddMachineDialog";
import { McpStatusBadge } from "@/components/admin/McpStatusBadge";

// Status pill lives in McpStatusBadge so machine pages can render
// the same chip without duplicating colors.

function CopyButton({ value, label }: { value: string; label?: string }) {
  const t = useTranslations("admin.mcp");
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="pill"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* ignore — clipboard may be blocked in some browsers */
        }
      }}
      aria-label={label ?? t("copy")}
    >
      <Copy className="h-3.5 w-3.5" />
      {copied ? t("copied") : t("copy")}
    </Button>
  );
}

// `accountId`, when set, scopes the list to a single account — used by
// the account-settings hub's MCP section. Without it (super-admin
// index), every configured account is shown.
//
// `embedded` skips the page-level H1 + description for use inside a
// section panel (the section header provides the title).
export function McpList({
  accountId,
  embedded = false,
}: { accountId?: string; embedded?: boolean } = {}) {
  const t = useTranslations("admin.mcp");
  const tc = useTranslations("common");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const callbackStatus = params.get("status");
  const callbackMessage = params.get("message");
  const scoped = Boolean(accountId);

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
          setLoadError(err instanceof Error ? err.message : t("loadFailed"));
        }),
    [t],
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
        setLoadError(err instanceof Error ? err.message : t("loadFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  // Surface callback result, then strip the query params so a refresh
  // doesn't re-show the banner. Disable the set-state-in-effect rule
  // here: we're translating a one-shot URL signal into UI state, which
  // is exactly the case the rule's docs treat as a legitimate
  // exception.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (callbackStatus === "ok") {
      setBanner({ kind: "ok", message: t("bannerConnected") });
    } else if (callbackStatus === "error") {
      setBanner({
        kind: "error",
        message: callbackMessage || t("bannerAuthFailed"),
      });
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    if (callbackStatus) {
      router.replace(pathname);
    }
  }, [callbackStatus, callbackMessage, router, pathname, t]);

  // When scoped to one account, drop everything else. Mutations still
  // hit the full /admin/mcp API (the routes are account-id-keyed under
  // the hood), so list filtering is all that's needed here.
  const visibleConfigs = configs
    ? scoped
      ? configs.filter((c) => c.accountId === accountId)
      : configs
    : null;

  // In the scoped view, "already configured" means this one account has
  // a row. Hide the add button in that case so admins don't get a
  // disabled picker.
  const hideAddButton =
    scoped && (visibleConfigs?.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div className="min-w-0">
          {embedded ? null : (
            <h1 className="text-[20px] font-semibold tracking-tight text-[var(--color-foreground)] sm:text-[24px]">
              {t("heading")}
            </h1>
          )}
          <p
            className={
              embedded
                ? "text-[13px] text-[var(--color-muted-foreground)] sm:text-[14px]"
                : "mt-1 text-[13px] text-[var(--color-muted-foreground)] sm:text-[14px]"
            }
          >
            {scoped ? t("descriptionScoped") : t("descriptionAll")}
          </p>
        </div>
        {hideAddButton ? null : (
          <Button
            variant="secondary"
            size="compact"
            onClick={() => setAddOpen(true)}
            className="self-start sm:self-auto"
          >
            {scoped ? t("connect") : t("addCredentials")}
          </Button>
        )}
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
              aria-label={tc("close")}
              className="text-current opacity-60 hover:opacity-100"
            >
              ×
            </button>
          </div>
        </div>
      ) : null}

      {scoped ? null : (
        <div className="rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-3 sm:p-4">
          <div className="text-[12px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
            {t("redirectUriLabel")}
          </div>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2 sm:gap-3">
            <code className="min-w-0 flex-1 break-all text-[13px] text-[var(--color-foreground)]">
              {redirectUri || "—"}
            </code>
            {redirectUri ? <CopyButton value={redirectUri} /> : null}
          </div>
          <p className="mt-2 text-[12px] text-[var(--color-muted-foreground)]">
            {t("redirectUriHint")}
          </p>
        </div>
      )}

      {addOpen ? (
        <AddMcpDialog
          existingAccountIds={
            new Set((configs ?? []).map((c) => c.accountId))
          }
          lockedAccountId={accountId ?? null}
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
      ) : visibleConfigs === null ? (
        <div className="flex h-32 items-center justify-center">
          <Spinner className="h-5 w-5" />
        </div>
      ) : visibleConfigs.length === 0 ? (
        <div className="rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-10 text-center text-[14px] text-[var(--color-muted-foreground)]">
          {scoped
            ? t.rich("emptyScoped", {
                strong: (chunks) => <strong>{chunks}</strong>,
              })
            : t.rich("emptyAll", {
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
        </div>
      ) : (
        <McpTable configs={visibleConfigs} onReload={reload} />
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
  const t = useTranslations("admin.mcp");
  return (
    <>
      {/* Mobile cards */}
      <div className="flex flex-col gap-2 sm:hidden">
        {configs.map((c) => (
          <McpCard key={c.accountId} config={c} onReload={onReload} />
        ))}
      </div>

      <div className="hidden overflow-x-auto sm:block">
        <DataTable className="min-w-[640px]">
          <DataTableHead>
            <DataTableHeader>{t("colAccount")}</DataTableHeader>
            <DataTableHeader>{t("colServer")}</DataTableHeader>
            <DataTableHeader>{t("colStatus")}</DataTableHeader>
            <DataTableHeader>{t("colTokenExpires")}</DataTableHeader>
            <DataTableHeader align="right" className="w-px">
              {t("colActions")}
            </DataTableHeader>
          </DataTableHead>
          <DataTableBody>
            {configs.map((c) => (
              <McpRow key={c.accountId} config={c} onReload={onReload} />
            ))}
          </DataTableBody>
        </DataTable>
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
  const t = useTranslations("admin.mcp");
  const confirm = useConfirm();
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
      setRowError(err instanceof Error ? err.message : t("authStartFailed"));
      setConnecting(false);
    }
  }

  async function disconnect() {
    const ok = await confirm({
      title: t("disconnectConfirmTitle", {
        name: config.label ?? config.accountId,
      }),
      description: t("disconnectConfirmBody"),
      confirmLabel: t("disconnectConfirmLabel"),
      danger: true,
    });
    if (!ok) return;
    setRowError(null);
    setDeleting(true);
    try {
      await deleteMcpConfig(config.accountId);
      await onReload();
    } catch (err) {
      setRowError(err instanceof Error ? err.message : t("disconnectFailed"));
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
        {t("tokenExpires", { date: tokenExpiry })}
      </p>
      <div className="flex items-center justify-end gap-2">
        <Button size="sm" onClick={startAuth} disabled={connecting || deleting}>
          {connecting ? (
            <Spinner className="h-3.5 w-3.5" />
          ) : config.status === "authorized" ? (
            t("reauthorize")
          ) : (
            t("connect")
          )}
        </Button>
        <Tooltip
          content={t("disconnect")}
          side="top"
          disabled={connecting || deleting}
        >
          <Button
            size="sm"
            variant="destructive"
            onClick={disconnect}
            disabled={connecting || deleting}
            aria-label={t("disconnect")}
          >
            {deleting ? (
              <Spinner className="h-3.5 w-3.5" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </Button>
        </Tooltip>
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
  const t = useTranslations("admin.mcp");
  const confirm = useConfirm();
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
      setRowError(err instanceof Error ? err.message : t("authStartFailed"));
      setConnecting(false);
    }
  }

  async function disconnect() {
    const ok = await confirm({
      title: t("disconnectConfirmTitle", {
        name: config.label ?? config.accountId,
      }),
      description: t("disconnectConfirmBody"),
      confirmLabel: t("disconnectConfirmLabel"),
      danger: true,
    });
    if (!ok) return;
    setRowError(null);
    setDeleting(true);
    try {
      await deleteMcpConfig(config.accountId);
      await onReload();
    } catch (err) {
      setRowError(err instanceof Error ? err.message : t("disconnectFailed"));
      setDeleting(false);
    }
  }

  const tokenExpiry = config.accessTokenExpiresAt
    ? new Date(config.accessTokenExpiresAt).toLocaleString()
    : "—";

  return (
    <DataTableRow className="align-top">
      <DataTableCell>
        <div className="font-medium">{config.label ?? config.accountId}</div>
        <div className="mt-0.5 text-[12px] text-[var(--ds-grey-medium-05)]">
          {config.accountId}
        </div>
      </DataTableCell>
      <DataTableCell className="text-[13px] text-[var(--ds-grey-medium-05)]">
        {config.serverUrl}
      </DataTableCell>
      <DataTableCell>
        <McpStatusBadge status={config.status} />
        {config.statusMessage ? (
          <div className="mt-1 max-w-[28ch] text-[12px] text-[var(--ds-red-dark)]">
            {config.statusMessage}
          </div>
        ) : null}
      </DataTableCell>
      <DataTableCell className="text-[13px] text-[var(--ds-grey-medium-05)]">
        {tokenExpiry}
      </DataTableCell>
      <DataTableCell align="right">
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" onClick={startAuth} disabled={connecting || deleting}>
            {connecting ? (
              <Spinner className="h-3.5 w-3.5" />
            ) : config.status === "authorized" ? (
              t("reauthorize")
            ) : (
              t("connect")
            )}
          </Button>
          <Tooltip
            content={t("disconnect")}
            side="top"
            disabled={connecting || deleting}
          >
            <Button
              size="sm"
              variant="destructive"
              onClick={disconnect}
              disabled={connecting || deleting}
              aria-label={t("disconnect")}
            >
              {deleting ? (
                <Spinner className="h-3.5 w-3.5" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
            </Button>
          </Tooltip>
        </div>
        {rowError ? (
          <div className="mt-1 text-[12px] text-[var(--ds-red-dark)]">
            {rowError}
          </div>
        ) : null}
      </DataTableCell>
    </DataTableRow>
  );
}

function AddMcpDialog({
  existingAccountIds,
  lockedAccountId,
  onClose,
  onSaved,
}: {
  existingAccountIds: Set<string>;
  // When set, the picker is hidden and registration always uses this
  // account. Used by the account-settings hub's MCP tab so admins
  // don't have to re-pick the account they're already inside.
  lockedAccountId: string | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const t = useTranslations("admin.mcp");
  const tc = useTranslations("common");
  // Dynamic Client Registration handles client_id / client_secret for
  // us — the admin only picks which Optipeople account these
  // credentials belong to and the MCP server URL.
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [accountId, setAccountId] = useState(lockedAccountId ?? "");
  const [serverUrl, setServerUrl] = useState("https://mcp.optipeople.dk");
  const [label, setLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLFormElement>(null);
  useFocusTrap(panelRef, true);

  // Load accounts the SuperAdmin has access to. Reuses the same
  // /api/Account/GetAll call as AddMachineDialog.
  useEffect(() => {
    // Every account the caller can reach, including ones with no
    // machines onboarded here yet — MCP credentials are often set up
    // as part of onboarding an account, before its first machine
    // exists.
    let cancelled = false;
    getAccounts()
      .then((rows) => {
        if (cancelled) return;
        setAccounts([...rows].sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setAccountsError(
          err instanceof Error ? err.message : t("accountsLoadFailed"),
        );
        setAccounts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

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
      setError(err instanceof Error ? err.message : t("registerFailed"));
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
        ref={panelRef}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="my-auto w-full max-w-[480px] rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-4 sm:p-6"
      >
        <h2 className="text-[17px] font-semibold tracking-tight text-[var(--color-foreground)] sm:text-[18px]">
          {t("addHeading")}
        </h2>
        <p className="mt-1 text-[13px] text-[var(--color-muted-foreground)]">
          {t.rich("addDescription", {
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
        </p>

        <div className="mt-4 flex flex-col gap-3">
          {lockedAccountId ? null : (
            <Combobox
              label={t("accountLabel")}
              placeholder={
                accounts === null
                  ? t("accountsLoading")
                  : t("accountsPlaceholder")
              }
              noMatchLabel={t("noMatch")}
              clearAriaLabel={t("clearAria")}
              loading={accounts === null}
              loadErr={accountsError}
              options={accounts ?? []}
              getKey={(a) => a.id}
              getLabel={(a) => a.name}
              getSubLabel={(a) =>
                existingAccountIds.has(a.id) ? t("alreadyConfigured") : null
              }
              isDisabledOption={(a) => existingAccountIds.has(a.id)}
              selected={accounts?.find((a) => a.id === accountId) ?? null}
              onSelect={(a) => setAccountId(a.id)}
              disabled={submitting}
            />
          )}
          <TextField
            label={t("serverUrlLabel")}
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="https://mcp.optipeople.dk"
            disabled={submitting}
          />
          <TextField
            label={t("labelLabel")}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t("labelPlaceholder")}
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
            {tc("cancel")}
          </Button>
          <Button size="sm" type="submit" disabled={!canSubmit}>
            {submitting ? <Spinner className="h-3.5 w-3.5" /> : t("register")}
          </Button>
        </div>
      </form>
    </div>
  );
}
