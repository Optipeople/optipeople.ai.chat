"use client";

// Landing screen for a scanned pre-printed QR sticker (/q/<token>).
//
// - linked:    hand over to the existing /?qr=<token> chat flow.
// - unknown /
//   retired:   dead end with the short code when we know it.
// - unclaimed: anonymous users get a login prompt, admins get a machine
//              picker that links the sticker, everyone else is told to
//              ask their administrator.
//
// Screen shells and cards are copied from MachineSelectScreen,
// NoMachineAccessScreen and QrErrorScreen so this reads as the same app.

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { AppHeader } from "@/components/AppHeader";
import { LoginScreen } from "@/components/LoginScreen";
import { Button, useConfirm, SearchField, Spinner, cn } from "@optipeople/ui";
import { isAdmin, isSuperAdmin, useAuth } from "@/auth/AuthContext";
import {
  AdminApiError,
  adminErrorMessage,
  getAdminMachines,
  linkQrSticker,
  type AdminMachine,
} from "@/admin/adminApi";
import type { QrStickerLookupResponse } from "@/lib/qrStickerTypes";

type LookupState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "done"; sticker: QrStickerLookupResponse };

// Codes are printed as XXXX-XXXX. Normalise whatever the API hands us so
// the screen always matches the sticker in the operator's hand.
function formatCode(code: string): string {
  const raw = code.replace(/[^0-9a-z]/gi, "").toUpperCase();
  return raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : code.toUpperCase();
}

function chatUrl(token: string): string {
  return `/?qr=${encodeURIComponent(token)}`;
}

export function QrStickerScan({ token }: { token: string }) {
  const t = useTranslations("qrSticker");
  const { user, isInitializing, isRoleLoading } = useAuth();
  const [lookup, setLookup] = useState<LookupState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [showLogin, setShowLogin] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/qr/stickers/${encodeURIComponent(token)}`,
          { cache: "no-store" },
        );
        if (res.status === 404) {
          if (!cancelled) {
            setLookup({ kind: "done", sticker: { status: "unknown" } });
          }
          return;
        }
        if (!res.ok) {
          if (!cancelled) {
            setLookup({
              kind: "error",
              message: t("lookupFailed", { status: res.status }),
            });
          }
          return;
        }
        const sticker = (await res.json()) as QrStickerLookupResponse;
        if (cancelled) return;
        if (sticker.status === "linked") {
          // The chat page prefers the URL token over anything stored in
          // this tab, so an older QR session cannot win here.
          window.location.replace(chatUrl(token));
          return;
        }
        setLookup({ kind: "done", sticker });
      } catch (err) {
        if (cancelled) return;
        console.error("QR sticker lookup failed", err);
        setLookup({ kind: "error", message: t("networkFailed") });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, reloadKey, t]);

  const retry = useCallback(() => {
    setLookup({ kind: "loading" });
    setReloadKey((k) => k + 1);
  }, []);

  if (lookup.kind === "loading" || isInitializing) {
    return <FullScreenSpinner />;
  }

  if (lookup.kind === "error") {
    return (
      <ErrorCard heading={t("errorHeading")} message={lookup.message}>
        <Button variant="secondary" size="lg" className="mt-4" onClick={retry}>
          {t("retry")}
        </Button>
      </ErrorCard>
    );
  }

  const sticker = lookup.sticker;

  if (sticker.status === "unknown") {
    return <ErrorCard heading={t("unknownHeading")} message={t("unknownBody")} />;
  }

  if (sticker.status === "retired") {
    return (
      <ErrorCard
        heading={t("retiredHeading")}
        message={t("retiredBody")}
        code={sticker.code}
      />
    );
  }

  if (sticker.status === "linked") {
    // Redirect is already under way.
    return <FullScreenSpinner />;
  }

  // Unclaimed from here on.
  if (!user) {
    if (showLogin) return <LoginScreen />;
    return (
      <CardScreen>
        <CardHeading>{t("notActivatedHeading")}</CardHeading>
        <CardText>{t("notActivatedLoggedOut")}</CardText>
        <CodeLine code={sticker.code} />
        <Button
          size="lg"
          className="mt-6 w-full"
          onClick={() => setShowLogin(true)}
        >
          {t("loginToActivate")}
        </Button>
      </CardScreen>
    );
  }

  if (isRoleLoading) {
    return <FullScreenSpinner />;
  }

  if (!isAdmin(user)) {
    return (
      <CardScreen>
        <CardHeading>{t("notActivatedHeading")}</CardHeading>
        <CardText>{t("notActivatedNonAdmin")}</CardText>
        <CodeLine code={sticker.code} />
      </CardScreen>
    );
  }

  return (
    <AdminLinkFlow
      token={token}
      code={sticker.code}
      stickerAccountId={sticker.accountId}
    />
  );
}

// Admin side of an unclaimed sticker: pick a machine, confirm, link.
function AdminLinkFlow({
  token,
  code,
  stickerAccountId,
}: {
  token: string;
  code: string;
  stickerAccountId: string | null;
}) {
  const t = useTranslations("qrSticker");
  const tErr = useTranslations("admin.apiErrors");
  const { user, accounts } = useAuth();
  const confirm = useConfirm();
  const superAdmin = isSuperAdmin(user);

  const [machines, setMachines] = useState<AdminMachine[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadKey, setLoadKey] = useState(0);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linked, setLinked] = useState<{ name: string; code: string } | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    getAdminMachines()
      .then((list) => {
        if (!cancelled) setMachines(list);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(adminErrorMessage(err, tErr) ?? t("machinesFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [loadKey, t, tErr]);

  const accountNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of accounts) map.set(a.id, a.name);
    return map;
  }, [accounts]);

  // One lowercase haystack per row, built once per list, so typing stays
  // fast with hundreds of machines.
  const rows = useMemo(() => {
    if (!machines) return [];
    return machines
      .filter((m) => !stickerAccountId || m.accountId === stickerAccountId)
      .map((m) => {
        const name = m.displayName?.trim() || m.machineId;
        const account = superAdmin
          ? (accountNames.get(m.accountId) ?? m.accountId)
          : null;
        return {
          id: m.machineId,
          name,
          account,
          haystack: `${name} ${m.machineId} ${account ?? ""}`.toLowerCase(),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [machines, stickerAccountId, superAdmin, accountNames]);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.haystack.includes(q));
  }, [rows, deferredQuery]);

  async function pick(row: { id: string; name: string }) {
    const ok = await confirm({
      title: t("confirmTitle", { machine: row.name }),
      description: t("confirmBody", { code: formatCode(code) }),
      confirmLabel: t("confirmLink"),
    });
    if (!ok) return;
    setLinkingId(row.id);
    setLinkError(null);
    try {
      const res = await linkQrSticker({ token, machineId: row.id });
      setLinked({
        name: res.sticker.machineName ?? row.name,
        code: res.sticker.code || code,
      });
    } catch (err) {
      // Any 409 here means the sticker changed under us (linked
      // elsewhere, retired, or a concurrent edit). The server text is
      // English only, so show our own translated message.
      const conflict =
        err instanceof AdminApiError && err.params.status === 409;
      setLinkError(
        conflict
          ? t("linkConflict")
          : (adminErrorMessage(err, tErr) ?? t("linkFailed")),
      );
    } finally {
      setLinkingId(null);
    }
  }

  if (linked) {
    return (
      <CardScreen>
        <div className="mb-3 flex items-center gap-2 text-[var(--color-foreground)]">
          <CheckCircle2 className="h-6 w-6 shrink-0 text-[var(--ds-green-80)]" />
          <CardHeading className="mb-0">{t("linkedHeading")}</CardHeading>
        </div>
        <CardText>
          {t("linkedBody", { machine: linked.name, code: formatCode(linked.code) })}
        </CardText>
        <Button
          size="lg"
          className="w-full"
          onClick={() => window.location.assign(chatUrl(token))}
        >
          {t("openChat")}
        </Button>
        <p className="mt-5 text-[14px] text-[var(--color-muted-foreground)] sm:text-[15px]">
          {t("nextStickerHint")}
        </p>
      </CardScreen>
    );
  }

  return (
    <CardScreen>
      <CardHeading>{t("pickHeading")}</CardHeading>
      <CardText>{t("pickBody", { code: formatCode(code) })}</CardText>

      {linkError && (
        <div className="mb-4 rounded-[4px] border border-[var(--ds-grey-light-02)] bg-[var(--color-muted)] p-4">
          <p className="text-[14px] text-[var(--color-error)]">{linkError}</p>
        </div>
      )}

      {machines === null && !loadError && (
        <div className="flex items-center gap-2 py-6 text-[15px] text-[var(--color-muted-foreground)]">
          <Spinner className="h-5 w-5" />
          {t("machinesLoading")}
        </div>
      )}

      {loadError && (
        <div className="mb-4 rounded-[4px] border border-[var(--ds-grey-light-02)] bg-[var(--color-muted)] p-4">
          <p className="mb-3 text-[14px] text-[var(--color-error)]">{loadError}</p>
          <Button
            type="button"
            onClick={() => {
              setLoadError(null);
              setLoadKey((k) => k + 1);
            }}
          >
            {t("retry")}
          </Button>
        </div>
      )}

      {machines !== null && rows.length === 0 && (
        <p className="py-4 text-[15px] text-[var(--color-muted-foreground)]">
          {stickerAccountId ? t("noMachinesForAccount") : t("noMachines")}
        </p>
      )}

      {rows.length > 0 && (
        <>
          <SearchField
            size="medium"
            className="mb-3"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onClear={() => setQuery("")}
            placeholder={t("searchPlaceholder")}
          />
          {filtered.length === 0 ? (
            <p className="py-4 text-[15px] text-[var(--color-muted-foreground)]">
              {t("noResults")}
            </p>
          ) : (
            <ul className="flex max-h-[min(60vh,480px)] flex-col gap-2 overflow-y-auto pr-1">
              {filtered.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    disabled={linkingId !== null}
                    onClick={() => void pick(row)}
                    className={cn(
                      "group flex w-full items-center justify-between gap-3 rounded-[4px] px-4 py-3 text-left",
                      "border border-[var(--ds-grey-light-02)] bg-[var(--color-surface)]",
                      "transition-[border-color,box-shadow] duration-150 ease-out",
                      "hover:border-[var(--ds-grey-light-03)] hover:shadow-[var(--ds-shadow-button)]",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-green-80)]",
                      "disabled:pointer-events-none",
                    )}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[16px] font-medium text-[var(--color-foreground)]">
                        {row.name}
                      </p>
                      {row.account && (
                        <p className="truncate text-[13px] text-[var(--color-muted-foreground)]">
                          {row.account}
                        </p>
                      )}
                    </div>
                    {linkingId === row.id ? (
                      <Spinner className="h-5 w-5 shrink-0" />
                    ) : (
                      <ChevronRight className="h-5 w-5 shrink-0 text-[var(--color-muted-foreground)] transition-transform group-hover:translate-x-0.5" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </CardScreen>
  );
}

// Shell copied from MachineSelectScreen / NoMachineAccessScreen.
function CardScreen({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex h-full flex-col bg-[var(--color-background)]">
      <AppHeader />
      <div className="flex flex-1 items-center justify-center px-4 py-6 sm:px-6 sm:py-10">
        <div
          className={cn(
            "msg-in w-full max-w-md rounded-[4px] bg-[var(--color-surface)] p-5 sm:p-8",
            "border-2 border-[var(--ds-grey-light-02)] shadow-[var(--ds-shadow-destructive)]",
          )}
        >
          {children}
        </div>
      </div>
      <div className="brand-stripe" aria-hidden>
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

function CardHeading({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <h1
      className={cn(
        "mb-1 text-[20px] font-semibold text-[var(--color-foreground)] sm:text-[22px]",
        className,
      )}
    >
      {children}
    </h1>
  );
}

function CardText({ children }: { children: ReactNode }) {
  return (
    <p className="mb-5 break-words text-[14px] text-[var(--color-muted-foreground)] sm:mb-6 sm:text-[15px]">
      {children}
    </p>
  );
}

function CodeLine({ code }: { code: string }) {
  const t = useTranslations("qrSticker");
  return (
    <p className="text-[14px] text-[var(--color-muted-foreground)] sm:text-[15px]">
      {t.rich("codeLabel", {
        code: formatCode(code),
        strong: (chunks) => (
          <span className="font-semibold text-[var(--color-foreground)]">
            {chunks}
          </span>
        ),
      })}
    </p>
  );
}

// Red dead-end card copied from QrErrorScreen in src/app/page.tsx.
function ErrorCard({
  heading,
  message,
  code,
  children,
}: {
  heading: string;
  message: string;
  code?: string;
  children?: ReactNode;
}) {
  const t = useTranslations("qrSticker");
  const tCommon = useTranslations("common");
  return (
    <div className="flex h-full items-center justify-center bg-[var(--color-background)] p-6">
      <div className="max-w-md rounded-[var(--radius-lg)] border border-red-200 bg-red-50 p-6 text-center">
        <p className="text-[16px] font-medium text-red-800">{heading}</p>
        <p className="mt-2 text-[14px] text-red-700">{message}</p>
        {code && (
          <p className="mt-2 text-[14px] text-red-700">
            {t.rich("codeLabel", {
              code: formatCode(code),
              strong: (chunks) => (
                <span className="font-semibold text-red-800">{chunks}</span>
              ),
            })}
          </p>
        )}
        {children}
        <div className="mt-5 border-t border-red-200 pt-4 text-[13px] text-red-800">
          <p className="text-red-700/80">{t("supportHint")}</p>
          <p className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 font-medium">
            <a
              href={`tel:${tCommon("supportPhone").replace(/\s+/g, "")}`}
              className="hover:underline"
            >
              {tCommon("supportPhone")}
            </a>
            <a
              href={`mailto:${tCommon("supportEmail")}`}
              className="hover:underline"
            >
              {tCommon("supportEmail")}
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

function FullScreenSpinner() {
  return (
    <div className="flex h-full items-center justify-center bg-[var(--color-background)]">
      <Spinner className="h-6 w-6" />
    </div>
  );
}
