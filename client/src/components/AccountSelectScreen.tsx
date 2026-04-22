import { useMemo, useState } from "react";
import { Loader2, LogOut, ChevronRight, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OptipeopleLogo } from "@/components/logo";
import { useAuth } from "@/auth/AuthContext";
import { cn } from "@/lib/utils";

export function AccountSelectScreen() {
  const {
    user,
    accounts,
    isLoadingAccounts,
    accountsError,
    selectAccount,
    reloadAccounts,
    logout,
  } = useAuth();

  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter((a) => a.name.toLowerCase().includes(q));
  }, [accounts, query]);

  const showSearch = accounts.length > 5;

  return (
    <div className="relative flex h-full flex-col bg-[var(--color-background)]">
      <header
        className="relative z-20 shrink-0"
        style={{ backgroundColor: "var(--color-brand)" }}
      >
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-6">
          <OptipeopleLogo
            className="h-7 w-auto text-white"
            aria-label="Optipeople"
          />
          {user && (
            <button
              type="button"
              onClick={logout}
              className={cn(
                "flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-medium",
                "bg-white/15 text-white transition-colors hover:bg-white/25",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
              )}
            >
              <LogOut className="h-4 w-4" />
              Log ud
            </button>
          )}
        </div>
      </header>

      <div className="flex flex-1 items-center justify-center px-6 py-10">
        <div
          className={cn(
            "msg-in w-full max-w-md rounded-[var(--radius-xl)] bg-[var(--color-surface)] p-8",
            "border border-[var(--color-hairline)] shadow-[var(--shadow-lg)]",
          )}
        >
          <h1 className="mb-1 text-[22px] font-semibold text-[var(--color-foreground)]">
            Vælg konto
          </h1>
          <p className="mb-6 text-[15px] text-[var(--color-muted-foreground)]">
            Du har adgang til flere konti. Vælg den du vil arbejde i.
          </p>

          {isLoadingAccounts && accounts.length === 0 && (
            <div className="flex items-center gap-2 py-6 text-[15px] text-[var(--color-muted-foreground)]">
              <Loader2 className="h-5 w-5 animate-spin" />
              Indlæser konti…
            </div>
          )}

          {accountsError && (
            <div className="mb-4 rounded-[var(--radius-sm)] border border-[var(--color-hairline)] bg-[var(--color-muted)] p-4">
              <p className="mb-3 text-[14px] text-[#b00020]">{accountsError}</p>
              <Button
                type="button"
                onClick={() => void reloadAccounts()}
                disabled={isLoadingAccounts}
                className="h-9 rounded-[var(--radius-sm)]"
              >
                {isLoadingAccounts ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Prøv igen"
                )}
              </Button>
            </div>
          )}

          {!isLoadingAccounts && !accountsError && accounts.length === 0 && (
            <p className="py-4 text-[15px] text-[var(--color-muted-foreground)]">
              Du har ikke adgang til nogen konti. Kontakt din administrator.
            </p>
          )}

          {accounts.length > 0 && (
            <>
              {showSearch && (
                <div
                  className={cn(
                    "mb-3 flex items-center gap-2 rounded-[var(--radius-sm)] px-3",
                    "border border-[var(--color-input)] bg-[var(--color-surface)]",
                    "focus-within:border-[var(--color-brand)]/40 focus-within:ring-2 focus-within:ring-[var(--color-ring)]",
                  )}
                >
                  <Search className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Søg efter konti…"
                    className="h-11 flex-1 bg-transparent text-[15px] text-[var(--color-foreground)] outline-none placeholder:text-[var(--color-muted-foreground)]"
                  />
                  {query && (
                    <button
                      type="button"
                      onClick={() => setQuery("")}
                      aria-label="Ryd søgning"
                      className="flex h-6 w-6 items-center justify-center rounded-full text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-muted)]"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              )}

              {filtered.length === 0 ? (
                <p className="py-4 text-[15px] text-[var(--color-muted-foreground)]">
                  Ingen resultater.
                </p>
              ) : (
                <ul className="flex max-h-[min(60vh,480px)] flex-col gap-2 overflow-y-auto pr-1">
                  {filtered.map((account) => (
                    <li key={account.id}>
                      <button
                        type="button"
                        onClick={() => selectAccount(account.id)}
                        className={cn(
                          "group flex w-full items-center justify-between gap-3 rounded-[var(--radius-sm)] px-4 py-3 text-left",
                          "border border-[var(--color-hairline)] bg-[var(--color-surface)]",
                          "transition-[border-color,box-shadow,transform] duration-200 ease-[var(--ease-apple)]",
                          "hover:-translate-y-[1px] hover:border-[var(--color-brand)]/40 hover:shadow-[var(--shadow-md)]",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
                        )}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[16px] font-medium text-[var(--color-foreground)]">
                            {account.name}
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
