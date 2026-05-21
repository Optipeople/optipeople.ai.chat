"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, MessageSquare } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import { Select } from "@/components/ui/select";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/ui/data-table";
import { getAdminMachines, type AdminMachine } from "@/admin/adminApi";
import { getAccounts } from "@/auth/accountsApi";
import {
  getAccountsHierarchy,
  type FactoryLite,
  type MachineFactoryMap,
} from "@/auth/factoriesApi";
import { AddMachineDialog } from "@/components/admin/AddMachineDialog";

export function MachinesList() {
  const router = useRouter();
  const t = useTranslations("admin.machinesList");
  const tc = useTranslations("common");
  const [machines, setMachines] = useState<AdminMachine[]>([]);
  const [accountNames, setAccountNames] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [accountFilter, setAccountFilter] = useState<string>("");
  const [factoryFilter, setFactoryFilter] = useState<string>("");
  const [factories, setFactories] = useState<FactoryLite[]>([]);
  const [machineToFactory, setMachineToFactory] = useState<MachineFactoryMap>(
    () => new Map(),
  );

  const reload = useCallback(async () => {
    const rows = await getAdminMachines();
    setMachines(rows);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getAdminMachines()
      .then((rows) => {
        if (cancelled) return;
        setMachines(rows);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : tc("unknownError"));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Resolve account IDs → names. Best-effort: if the lookup fails (e.g.
  // operator role) we just fall back to showing the ID.
  useEffect(() => {
    let cancelled = false;
    getAccounts()
      .then((rows) => {
        if (cancelled) return;
        setAccountNames(new Map(rows.map((a) => [a.id, a.name])));
      })
      .catch(() => {
        /* fall back to IDs */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Factory membership lives on the Optipeople platform, not in our KB
  // tables. Best-effort fetch — if it fails (e.g. operator role) the
  // Factory filter just stays empty.
  useEffect(() => {
    let cancelled = false;
    getAccountsHierarchy()
      .then((h) => {
        if (cancelled) return;
        setFactories(h.factories);
        setMachineToFactory(h.machineToFactory);
      })
      .catch(() => {
        /* filter stays disabled */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Reset factory selection if it no longer belongs to the picked account.
  useEffect(() => {
    if (!factoryFilter) return;
    const f = factories.find((x) => x.id === factoryFilter);
    if (!f) return;
    if (accountFilter && f.accountId !== accountFilter) {
      setFactoryFilter("");
    }
  }, [accountFilter, factoryFilter, factories]);

  const availableFactories = useMemo(() => {
    if (!accountFilter) return factories;
    return factories.filter((f) => f.accountId === accountFilter);
  }, [factories, accountFilter]);

  const accountOptions = useMemo(() => {
    const ids = new Set(machines.map((m) => m.accountId));
    return Array.from(ids)
      .map((id) => ({ id, name: accountNames.get(id) ?? id }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [machines, accountNames]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return machines.filter((m) => {
      if (accountFilter && m.accountId !== accountFilter) return false;
      if (factoryFilter) {
        const f = machineToFactory.get(m.machineId);
        if (!f || f.factoryId !== factoryFilter) return false;
      }
      if (!q) return true;
      const name = (m.displayName ?? "").toLowerCase();
      const accountName = (accountNames.get(m.accountId) ?? "").toLowerCase();
      const factoryName = (
        machineToFactory.get(m.machineId)?.factoryName ?? ""
      ).toLowerCase();
      return (
        name.includes(q) ||
        accountName.includes(q) ||
        factoryName.includes(q) ||
        m.machineId.toLowerCase().includes(q)
      );
    });
  }, [
    machines,
    query,
    accountNames,
    accountFilter,
    factoryFilter,
    machineToFactory,
  ]);

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
              : filtered.length === machines.length
                ? t("countLabel", { count: machines.length })
                : t("countLabelFiltered", {
                    shown: filtered.length,
                    total: machines.length,
                  })}
          </p>
        </div>
        <Button
          variant="secondary"
          size="compact"
          onClick={() => setAddOpen(true)}
          className="self-start sm:self-auto"
        >
          {t("addMachine")}
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3 sm:gap-4">
          <FilterSelect
            label={t("filterAccount")}
            value={accountFilter}
            onChange={setAccountFilter}
            allLabel={t("filterAllAccounts")}
            options={accountOptions}
          />
          <FilterSelect
            label={t("filterFactory")}
            value={factoryFilter}
            onChange={setFactoryFilter}
            allLabel={t("filterAllFactories")}
            options={availableFactories.map((f) => ({
              id: f.id,
              name: f.name,
            }))}
            disabled={factories.length === 0}
          />
        </div>
        <SearchField
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onClear={() => setQuery("")}
          placeholder={t("searchPlaceholder")}
          className="w-full sm:w-80"
        />
      </div>

      <hr className="my-2 border-0 border-t border-[var(--ds-grey-light-02)]" />

      {addOpen && (
        <AddMachineDialog
          existingMachineIds={new Set(machines.map((m) => m.machineId))}
          onClose={() => setAddOpen(false)}
          onCreated={reload}
        />
      )}

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
          {machines.length === 0 ? t("emptyFirst") : t("emptySearch")}
        </div>
      ) : (
        <>
          {/* Mobile card list */}
          <div className="flex flex-col gap-2 sm:hidden">
            {filtered.map((m) => (
              <div
                key={m.machineId}
                onClick={() => router.push(`/admin/machines/${m.machineId}`)}
                className={cn(
                  "group flex cursor-pointer items-center gap-3 rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-3",
                  "transition-colors active:bg-[var(--color-muted)]/60",
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium text-[var(--color-foreground)]">
                    {m.displayName ?? t("noName")}
                  </p>
                  <p className="mt-0.5 truncate text-[12px] text-[var(--color-muted-foreground)]">
                    {accountNames.get(m.accountId) ?? m.accountId}
                  </p>
                  <p className="mt-1.5 text-[12px] text-[var(--color-muted-foreground)]">
                    {t("colDocuments")}:{" "}
                    <span className="tabular-nums text-[var(--color-foreground)]">
                      {m.documentCount}
                    </span>
                  </p>
                </div>
                <a
                  href={`/?account=${encodeURIComponent(m.accountId)}&machine=${encodeURIComponent(m.machineId)}`}
                  onClick={(e) => e.stopPropagation()}
                  title={t("openChatTitle")}
                  aria-label={t("openChatAria")}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
                >
                  <MessageSquare className="h-4 w-4" />
                </a>
                <ChevronRight className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" />
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden sm:block">
            <DataTable>
              <DataTableHead>
                <DataTableHeader>{t("colName")}</DataTableHeader>
                <DataTableHeader>{t("colAccount")}</DataTableHeader>
                <DataTableHeader>{t("colFactory")}</DataTableHeader>
                <DataTableHeader align="right">{t("colDocuments")}</DataTableHeader>
                <DataTableHeader className="w-10" />
                <DataTableHeader className="w-10" />
              </DataTableHead>
              <DataTableBody>
                {filtered.map((m) => {
                  const factoryName =
                    machineToFactory.get(m.machineId)?.factoryName ?? null;
                  return (
                    <DataTableRow
                      key={m.machineId}
                      onClick={() => router.push(`/admin/machines/${m.machineId}`)}
                    >
                      <DataTableCell className="group-hover:underline">
                        {m.displayName ?? t("noName")}
                      </DataTableCell>
                      <DataTableCell>
                        {accountNames.get(m.accountId) ?? m.accountId}
                      </DataTableCell>
                      <DataTableCell>{factoryName ?? "–"}</DataTableCell>
                      <DataTableCell align="right" className="tabular-nums">
                        {m.documentCount}
                      </DataTableCell>
                      <DataTableCell align="right">
                        <a
                          href={`/?account=${encodeURIComponent(m.accountId)}&machine=${encodeURIComponent(m.machineId)}`}
                          onClick={(e) => e.stopPropagation()}
                          title={t("openChatTitle")}
                          aria-label={t("openChatAria")}
                          className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--ds-grey-medium-05)] hover:bg-white hover:text-[var(--ds-grey-dark-09)]"
                        >
                          <MessageSquare className="h-4 w-4" />
                        </a>
                      </DataTableCell>
                      <DataTableCell align="right">
                        <ChevronRight className="ml-auto h-4 w-4 text-[var(--ds-grey-medium-05)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--ds-grey-dark-09)]" />
                      </DataTableCell>
                    </DataTableRow>
                  );
                })}
              </DataTableBody>
            </DataTable>
          </div>
        </>
      )}
    </div>
  );
}

type FilterSelectProps = {
  label: string;
  value: string;
  onChange: (next: string) => void;
  allLabel: string;
  options: ReadonlyArray<{ id: string; name: string }>;
  disabled?: boolean;
};

function FilterSelect({
  label,
  value,
  onChange,
  allLabel,
  options,
  disabled,
}: FilterSelectProps) {
  const isEmpty = options.length === 0;
  const dim = disabled || isEmpty;
  return (
    <div className="min-w-[160px] sm:w-[200px]">
      <Select
        label={label}
        value={value}
        onValueChange={onChange}
        disabled={dim}
      >
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </Select>
    </div>
  );
}
