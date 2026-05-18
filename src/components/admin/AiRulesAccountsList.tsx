"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { SearchField } from "@/components/ui/search-field";
import { getAccounts, type Account } from "@/auth/accountsApi";
import { getRegisteredSets } from "@/auth/registeredApi";
import { cn } from "@/lib/utils";

// Lists every Optipeople account that has at least one machine onboarded
// into this Opti Assist instance. Clicking a row drops into the rules editor
// for that account. We don't preload rule counts — the editor fetches
// fresh on entry, and showing stale counts here would be misleading.

export function AiRulesAccountsList() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
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
        setError(err instanceof Error ? err.message : "Failed to load accounts");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!accounts) return [];
    const q = query.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter(
      (a) =>
        a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q),
    );
  }, [accounts, query]);

  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold tracking-tight text-[var(--color-foreground)] sm:text-[24px]">
            AI rules
          </h1>
          <p className="mt-1 text-[13px] text-[var(--color-muted-foreground)] sm:text-[14px]">
            Rules injected into the Opti Assist system prompt for every chat in
            the account. Pick an account to manage its rules.
          </p>
        </div>
        <SearchField
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onClear={() => setQuery("")}
          placeholder="Search accounts"
          className="w-full sm:w-72"
        />
      </div>

      {error ? (
        <div className="rounded-[4px] border border-[var(--ds-tag-red-dark)] bg-[var(--ds-tag-red-light)] p-6 text-[14px] text-[var(--ds-red-dark)]">
          {error}
        </div>
      ) : accounts === null ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--color-muted-foreground)]" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-10 text-center text-[14px] text-[var(--color-muted-foreground)]">
          {accounts.length === 0
            ? "No accounts have machines onboarded yet."
            : "No accounts match your search."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)]">
          {filtered.map((a, i) => (
            <Link
              key={a.id}
              href={`/admin/rules/${encodeURIComponent(a.id)}`}
              className={cn(
                "flex cursor-pointer items-center gap-3 p-3 sm:px-4",
                "transition-colors hover:bg-[var(--color-muted)]/60",
                i > 0 && "border-t border-[var(--color-hairline)]",
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-medium text-[var(--color-foreground)]">
                  {a.name}
                </p>
                <p className="mt-0.5 truncate font-mono text-[11px] text-[var(--color-muted-foreground)]">
                  {a.id}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
