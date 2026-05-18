"use client";

import { useMemo, useState } from "react";
import { Loader2, ChevronRight, ChevronLeft, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { OptipeopleLogo } from "@/components/logo";
import { UserMenu } from "@/components/UserMenu";
import { useAuth } from "@/auth/AuthContext";
import { cn } from "@/lib/utils";

export function MachineSelectScreen() {
  const {
    accounts,
    currentAccount,
    machines,
    isLoadingMachines,
    machinesError,
    selectMachine,
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

  const canGoBack = accounts.length > 1;

  return (
    <div className="relative flex h-full flex-col bg-[var(--color-background)]">
      <header
        className="relative z-20 shrink-0"
        style={{ backgroundColor: "var(--color-brand)" }}
      >
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-3 px-4 sm:h-16 sm:px-6">
          <OptipeopleLogo
            className="h-6 w-auto shrink-0 text-white sm:h-7"
            aria-label="Optipeople"
          />
          <UserMenu />
        </div>
      </header>

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
              <Loader2 className="h-5 w-5 animate-spin" />
              {t("loading")}
            </div>
          )}

          {machinesError && (
            <div className="mb-4 rounded-[4px] border border-[var(--ds-grey-light-02)] bg-[var(--color-muted)] p-4">
              <p className="mb-3 text-[14px] text-[#b00020]">{machinesError}</p>
              <Button
                type="button"
                onClick={() => void reloadMachines()}
                disabled={isLoadingMachines}
              >
                {isLoadingMachines ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  tc("retry")
                )}
              </Button>
            </div>
          )}

          {!isLoadingMachines && !machinesError && machines.length === 0 && (
            <p className="py-4 text-[15px] text-[var(--color-muted-foreground)]">
              {t.rich("empty", {
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
