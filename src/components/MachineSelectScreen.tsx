"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Boxes, ChevronRight, ChevronLeft, Search, X } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { AppHeader } from "@/components/AppHeader";
import { isAdmin, isSuperAdmin, useAuth } from "@/auth/AuthContext";
import { cn } from "@/lib/utils";

export function MachineSelectScreen() {
  const {
    user,
    accounts,
    currentAccount,
    machines,
    isLoadingMachines,
    machinesError,
    selectMachine,
    selectFleet,
    reloadMachines,
    clearSelectedAccount,
  } = useAuth();
  const t = useTranslations("machineSelect");
  const tc = useTranslations("common");

  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return machines;
    return machines.filter((m) => m.name.toLowerCase().includes(q));
  }, [machines, query]);

  // Super admins/partners can always return to the picker — it hosts the
  // "New account" button, even when they only see one account today.
  const canGoBack = accounts.length > 1 || isSuperAdmin(user);

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
          <h1 className="mb-1 text-[20px] font-semibold text-[var(--color-foreground)] sm:text-[22px]">
            {t("heading")}
          </h1>
          <p className="mb-5 break-words text-[14px] text-[var(--color-muted-foreground)] sm:mb-6 sm:text-[15px]">
            {currentAccount
              ? t("subtitleForAccount", { account: currentAccount.name })
              : t("subtitleNoAccount")}
          </p>

          {isLoadingMachines && machines.length === 0 && (
            <div className="flex items-center gap-2 py-6 text-[15px] text-[var(--color-muted-foreground)]">
              <Spinner className="h-5 w-5" />
              {t("loading")}
            </div>
          )}

          {machinesError && (
            <div className="mb-4 rounded-[4px] border border-[var(--ds-grey-light-02)] bg-[var(--color-muted)] p-4">
              <p className="mb-3 text-[14px] text-[var(--color-error)]">{machinesError}</p>
              <Button
                type="button"
                onClick={() => void reloadMachines()}
                disabled={isLoadingMachines}
              >
                {isLoadingMachines ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  tc("retry")
                )}
              </Button>
            </div>
          )}

          {!isLoadingMachines && !machinesError && machines.length === 0 && (
            <p className="py-4 text-[15px] text-[var(--color-muted-foreground)]">
              {/* Admins can reach accounts with nothing onboarded yet —
                  point them at the place where they fix that instead of
                  telling them to email support. */}
              {isAdmin(user)
                ? t.rich("emptyAdmin", {
                    link: () => (
                      <Link
                        href="/admin/machines"
                        className="font-medium text-[var(--color-foreground)] underline underline-offset-2 hover:text-[var(--color-brand)]"
                      >
                        {t("emptyAdminLink")}
                      </Link>
                    ),
                  })
                : t.rich("empty", {
                    email: () => (
                      <a
                        href={`mailto:${tc("supportEmail")}`}
                        className="font-medium text-[var(--color-foreground)] underline underline-offset-2 hover:text-[var(--color-brand)]"
                      >
                        {tc("supportEmail")}
                      </a>
                    ),
                  })}
            </p>
          )}

          {machines.length > 0 && (
            <>
              {/* Fleet scope: chat across every machine at once. Sits
                  above the search box (it must not be filtered away) and
                  reuses the machine-row anatomy so it reads as a peer
                  choice, not a different control. Only offered when
                  there is actually a fleet to span. */}
              {machines.length > 1 && (
                <button
                  type="button"
                  onClick={selectFleet}
                  className={cn(
                    "group mb-3 flex w-full items-center justify-between gap-3 rounded-[4px] px-4 py-3 text-left",
                    "border border-[var(--ds-grey-light-02)] bg-[var(--color-surface)]",
                    "transition-[border-color,box-shadow] duration-150 ease-out",
                    "hover:border-[var(--ds-grey-light-03)] hover:shadow-[var(--ds-shadow-button)]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-green-80)]",
                  )}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Boxes className="h-5 w-5 shrink-0 text-[var(--color-muted-foreground)]" />
                    <div className="min-w-0">
                      <p className="truncate text-[16px] font-medium text-[var(--color-foreground)]">
                        {t("fleetEntry")}
                      </p>
                      <p className="truncate text-[13px] text-[var(--color-muted-foreground)]">
                        {t("fleetEntrySub", { count: machines.length })}
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0 text-[var(--color-muted-foreground)] transition-transform group-hover:translate-x-0.5" />
                </button>
              )}
              <div
                className={cn(
                  "mb-3 flex items-center gap-2 rounded-[4px] px-3",
                  "border border-[var(--ds-grey-light-02)] bg-[var(--color-surface)]",
                  "focus-within:border-[var(--ds-grey-light-03)] focus-within:ring-2 focus-within:ring-[var(--ds-green-80)]",
                )}
              >
                <Search className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("search")}
                  className="h-11 flex-1 bg-transparent text-[15px] text-[var(--color-foreground)] outline-none placeholder:text-[var(--color-muted-foreground)]"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label={tc("clearSearch")}
                    className="flex h-6 w-6 items-center justify-center rounded-[2px] text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-muted)]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              {filtered.length === 0 ? (
                <p className="py-4 text-[15px] text-[var(--color-muted-foreground)]">
                  {tc("noResults")}
                </p>
              ) : (
                <ul className="flex max-h-[min(60vh,480px)] flex-col gap-2 overflow-y-auto pr-1">
                  {filtered.map((machine) => (
                    <li key={machine.id}>
                      <button
                        type="button"
                        onClick={() => selectMachine(machine.id)}
                        className={cn(
                          "group flex w-full items-center justify-between gap-3 rounded-[4px] px-4 py-3 text-left",
                          "border border-[var(--ds-grey-light-02)] bg-[var(--color-surface)]",
                          "transition-[border-color,box-shadow] duration-150 ease-out",
                          "hover:border-[var(--ds-grey-light-03)] hover:shadow-[var(--ds-shadow-button)]",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-green-80)]",
                        )}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[16px] font-medium text-[var(--color-foreground)]">
                            {machine.name}
                          </p>
                        </div>
                        <ChevronRight className="h-5 w-5 shrink-0 text-[var(--color-muted-foreground)] transition-transform group-hover:translate-x-0.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {canGoBack && (
            <button
              type="button"
              onClick={clearSelectedAccount}
              className={cn(
                "mt-6 flex items-center gap-1.5 text-[14px] font-medium",
                "text-[var(--color-muted-foreground)] transition-colors hover:text-[var(--color-foreground)]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] rounded-sm",
              )}
            >
              <ChevronLeft className="h-4 w-4" />
              {t("switchAccount")}
            </button>
          )}
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
