"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Spinner } from "@/components/ui/spinner";
import { SearchField } from "@/components/ui/search-field";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/ui/data-table";
import { getAccounts, type Account } from "@/auth/accountsApi";
import { getAdminMachines, getAdminUsageOverview } from "@/admin/adminApi";
import { isAccountAdmin, useAuth } from "@/auth/AuthContext";

// tokens30d is input+output over the last 30 days; null means the usage
// endpoint failed (the list still renders, the column shows —).
type AccountRow = Account & { machineCount: number; tokens30d: number | null };

const TOKENS_FMT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

type SortKey = "name" | "machines" | "tokens";

function SortButton({
  active,
  dir,
  onClick,
  children,
}: {
  active: boolean;
  dir: 1 | -1;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-green-80)]"
    >
      {children}
      {active ? (
        dir === 1 ? (
          <ArrowUp aria-hidden className="h-3.5 w-3.5" />
        ) : (
          <ArrowDown aria-hidden className="h-3.5 w-3.5" />
        )
      ) : (
        <ArrowUpDown aria-hidden className="h-3.5 w-3.5 opacity-40" />
      )}
    </button>
  );
}

// Picker for /admin/accounts. Super admins and partners see every
// Optipeople account they have access to — including ones with no
// machines onboarded here yet, so they can configure an account before
// (or while) adding its first machine. The machine count tells them
// which is which. Account admins skip the picker — they only ever have
// one account they can manage, so we hop straight into the hub.
export function AccountsList() {
  const t = useTranslations("admin.accountsList");
  const router = useRouter();
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<AccountRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({
    key: "name",
    dir: 1,
  });

  useEffect(() => {
    if (isAccountAdmin(user) && user?.accountId) {
      router.replace(
        `/admin/accounts/${encodeURIComponent(user.accountId)}`,
      );
    }
  }, [user, router]);

  useEffect(() => {
    if (isAccountAdmin(user)) return;
    let cancelled = false;
    Promise.all([
      getAccounts(),
      getAdminMachines(),
      // Usage is decoration on this list — never let it block or fail
      // the account picker.
      getAdminUsageOverview().catch(() => null),
    ])
      .then(([rows, machines, usage]) => {
        if (cancelled) return;
        const counts = new Map<string, number>();
        for (const m of machines) {
          counts.set(m.accountId, (counts.get(m.accountId) ?? 0) + 1);
        }
        const tokens =
          usage === null
            ? null
            : new Map(
                usage.map((u) => [u.accountId, u.inputTokens + u.outputTokens]),
              );
        const merged: AccountRow[] = rows.map((a) => ({
          ...a,
          machineCount: counts.get(a.id) ?? 0,
          tokens30d: tokens ? (tokens.get(a.id) ?? 0) : null,
        }));
        setAccounts(merged);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : t("loadFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [user, t]);

  const filtered = useMemo(() => {
    if (!accounts) return [];
    const q = query.trim().toLowerCase();
    const rows = q
      ? accounts.filter(
          (a) =>
            a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q),
        )
      : [...accounts];
    rows.sort((a, b) => {
      const cmp =
        sort.key === "name"
          ? a.name.localeCompare(b.name)
          : sort.key === "machines"
            ? a.machineCount - b.machineCount
            : (a.tokens30d ?? -1) - (b.tokens30d ?? -1);
      return cmp * sort.dir;
    });
    return rows;
  }, [accounts, query, sort]);

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 1 ? -1 : 1 }
        : { key, dir: key === "name" ? 1 : -1 },
    );
  }

  if (isAccountAdmin(user)) {
    return (
      <div className="flex h-32 items-center justify-center">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }

  const loading = accounts === null && !error;
  const total = accounts?.length ?? 0;

  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold tracking-tight text-[var(--color-foreground)] sm:text-[24px]">
            {t("heading")}
          </h1>
          <p className="mt-1 text-[13px] text-[var(--color-muted-foreground)] sm:text-[14px]">
            {loading
              ? t("loading")
              : filtered.length === total
                ? t("countLabel", { count: total })
                : t("countLabelFiltered", {
                    shown: filtered.length,
                    total,
                  })}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <SearchField
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onClear={() => setQuery("")}
          placeholder={t("searchPlaceholder")}
          className="w-full sm:w-80"
        />
      </div>

      <hr className="my-2 border-0 border-t border-[var(--ds-grey-light-02)]" />

      {error ? (
        <div className="rounded-[4px] border border-[var(--ds-tag-red-dark)] bg-[var(--ds-tag-red-light)] p-6 text-[14px] text-[var(--ds-red-dark)]">
          {error}
        </div>
      ) : loading ? (
        <div className="flex h-32 items-center justify-center">
          <Spinner className="h-5 w-5" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-10 text-center text-[14px] text-[var(--color-muted-foreground)]">
          {total === 0 ? t("emptyNone") : t("emptySearch")}
        </div>
      ) : (
        <>
          {/* Mobile card list */}
          <div className="flex flex-col gap-2 sm:hidden">
            {filtered.map((a) => (
              <Link
                key={a.id}
                href={`/admin/accounts/${encodeURIComponent(a.id)}`}
                className="group flex items-center gap-3 rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-3 transition-colors active:bg-[var(--color-muted)]/60"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium text-[var(--color-foreground)]">
                    {a.name}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-[var(--color-muted-foreground)]">
                    {a.id}
                  </p>
                  <p className="mt-1.5 text-[12px] text-[var(--color-muted-foreground)]">
                    {t("colMachines")}:{" "}
                    <span className="tabular-nums text-[var(--color-foreground)]">
                      {a.machineCount}
                    </span>
                    <span className="mx-1.5">·</span>
                    {t("colTokens")}:{" "}
                    <span className="tabular-nums text-[var(--color-foreground)]">
                      {a.tokens30d === null ? "—" : TOKENS_FMT.format(a.tokens30d)}
                    </span>
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" />
              </Link>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden sm:block">
            <DataTable>
              <DataTableHead>
                <DataTableHeader>
                  <SortButton
                    active={sort.key === "name"}
                    dir={sort.dir}
                    onClick={() => toggleSort("name")}
                  >
                    {t("colName")}
                  </SortButton>
                </DataTableHeader>
                <DataTableHeader>{t("colAccountId")}</DataTableHeader>
                <DataTableHeader align="right">
                  <SortButton
                    active={sort.key === "machines"}
                    dir={sort.dir}
                    onClick={() => toggleSort("machines")}
                  >
                    {t("colMachines")}
                  </SortButton>
                </DataTableHeader>
                <DataTableHeader align="right">
                  <SortButton
                    active={sort.key === "tokens"}
                    dir={sort.dir}
                    onClick={() => toggleSort("tokens")}
                  >
                    {t("colTokens")}
                  </SortButton>
                </DataTableHeader>
                <DataTableHeader className="w-10" />
              </DataTableHead>
              <DataTableBody>
                {filtered.map((a) => (
                  <DataTableRow
                    key={a.id}
                    href={`/admin/accounts/${encodeURIComponent(a.id)}`}
                  >
                    <DataTableCell className="group-hover:underline">
                      {a.name}
                    </DataTableCell>
                    <DataTableCell className="font-mono text-[12px]">
                      {a.id}
                    </DataTableCell>
                    <DataTableCell align="right" className="tabular-nums">
                      {a.machineCount}
                    </DataTableCell>
                    <DataTableCell align="right" className="tabular-nums">
                      {a.tokens30d === null ? "—" : TOKENS_FMT.format(a.tokens30d)}
                    </DataTableCell>
                    <DataTableCell align="right">
                      <ChevronRight className="ml-auto h-4 w-4 text-[var(--ds-grey-medium-05)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--ds-grey-dark-09)]" />
                    </DataTableCell>
                  </DataTableRow>
                ))}
              </DataTableBody>
            </DataTable>
          </div>
        </>
      )}
    </div>
  );
}
