"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronRight,
  MessageSquare,
  QrCode,
} from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ProgressBar } from "@/components/ui/progress-bar";
import { useConfirm } from "@/components/ui/confirm-dialog";
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
import {
  adminErrorMessage,
  bulkMachineQr,
  getAdminMachines,
  type AdminMachine,
} from "@/admin/adminApi";
import { downloadStickerPdf, machineQrUrl } from "@/admin/qrStickerPdf";
import { getAccounts } from "@/auth/accountsApi";
import {
  getAccountsHierarchy,
  type FactoryLite,
  type MachineFactoryMap,
} from "@/auth/factoriesApi";
import { AddMachineDialog } from "@/components/admin/AddMachineDialog";

type MachineSortKey = "name" | "documents";

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

export function MachinesList() {
  const t = useTranslations("admin.machinesList");
  const tc = useTranslations("common");
  const tb = useTranslations("admin.qrStickers.bulkPrint");
  const tq = useTranslations("admin.qrPrint");
  const tErr = useTranslations("admin.apiErrors");
  const confirm = useConfirm();
  const searchParams = useSearchParams();
  const [machines, setMachines] = useState<AdminMachine[]>([]);
  const [accountNames, setAccountNames] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  // Deep links (e.g. the account hub's "Machines" section) can pre-filter
  // the list with ?account=<id>.
  const [accountFilter, setAccountFilter] = useState<string>(
    () => searchParams?.get("account") ?? "",
  );
  const [factoryFilter, setFactoryFilter] = useState<string>("");
  const [sort, setSort] = useState<{ key: MachineSortKey; dir: 1 | -1 }>({
    key: "name",
    dir: 1,
  });
  const [factories, setFactories] = useState<FactoryLite[]>([]);
  const [machineToFactory, setMachineToFactory] = useState<MachineFactoryMap>(
    () => new Map(),
  );
  // Machines picked for bulk QR sticker printing. Kept across filter
  // changes so an admin can build a selection from several searches.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [printProgress, setPrintProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [printErr, setPrintErr] = useState<string | null>(null);

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
      // Cross-filter dependency: this effect IS the synchronisation.
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
    const rows = machines.filter((m) => {
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
    rows.sort((a, b) => {
      const cmp =
        sort.key === "name"
          ? (a.displayName ?? "").localeCompare(b.displayName ?? "")
          : a.documentCount - b.documentCount;
      return cmp * sort.dir;
    });
    return rows;
  }, [
    machines,
    query,
    accountNames,
    accountFilter,
    factoryFilter,
    machineToFactory,
    sort,
  ]);

  const filteredIds = useMemo(
    () => filtered.map((m) => m.machineId),
    [filtered],
  );
  const selectedInView = filteredIds.filter((id) => selected.has(id)).length;
  const allInViewSelected =
    filteredIds.length > 0 && selectedInView === filteredIds.length;
  const printing = printProgress !== null;

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllInView() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allInViewSelected) filteredIds.forEach((id) => next.delete(id));
      else filteredIds.forEach((id) => next.add(id));
      return next;
    });
  }

  // Named stickers for the selected machines, one per page. The server
  // mints a QR token for any machine that lacks one, so confirm first.
  async function printStickers() {
    const ids = machines
      .map((m) => m.machineId)
      .filter((id) => selected.has(id));
    if (ids.length === 0 || printing) return;
    const ok = await confirm({
      title: tb("confirmTitle", { count: ids.length }),
      description: tb("confirmBody"),
      confirmLabel: tb("confirmLabel"),
    });
    if (!ok) return;
    setPrintErr(null);
    setPrintProgress({ done: 0, total: ids.length });
    try {
      // The bulk endpoint takes at most 500 machines per call.
      const machines: Awaited<ReturnType<typeof bulkMachineQr>>["machines"] = [];
      for (let i = 0; i < ids.length; i += 500) {
        const res = await bulkMachineQr(ids.slice(i, i + 500));
        machines.push(...res.machines);
      }
      const eyebrow = tq("scanAndAsk");
      const supportPhone = tc("supportPhone");
      const supportEmail = tc("supportEmail");
      await downloadStickerPdf(
        machines.map((m) => ({
          machineName: m.displayName ?? tq("noName"),
          qrUrl: machineQrUrl(m.token),
          eyebrow,
          supportPhone,
          supportEmail,
        })),
        "qr-stickers-machines.pdf",
        (done, total) => setPrintProgress({ done, total }),
      );
    } catch (e) {
      setPrintErr(adminErrorMessage(e, tErr) ?? tc("unknownError"));
    } finally {
      setPrintProgress(null);
    }
  }

  function toggleSort(key: MachineSortKey) {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 1 ? -1 : 1 }
        : { key, dir: key === "name" ? 1 : -1 },
    );
  }

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

      {(selected.size > 0 || printErr) && (
        <div className="flex flex-col gap-2">
          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] text-[var(--color-muted-foreground)]">
                {tb("selectedCount", { count: selected.size })}
              </span>
              <Button
                variant="ghost"
                size="pill"
                onClick={() => setSelected(new Set())}
                disabled={printing}
              >
                {tb("clearSelection")}
              </Button>
              <Button
                variant="ghost"
                size="pill"
                onClick={() => void printStickers()}
                disabled={printing}
              >
                {printing ? (
                  <Spinner className="h-3.5 w-3.5" />
                ) : (
                  <QrCode className="h-3.5 w-3.5" />
                )}
                {tb("print", { count: selected.size })}
              </Button>
            </div>
          )}
          {printProgress && (
            <div className="flex flex-col gap-1.5">
              <ProgressBar
                value={
                  printProgress.total > 0
                    ? (printProgress.done / printProgress.total) * 100
                    : 0
                }
              />
              <p className="text-[12px] text-[var(--color-muted-foreground)]">
                {tb("progress", {
                  done: printProgress.done,
                  total: printProgress.total,
                })}
              </p>
            </div>
          )}
          {printErr && (
            <p className="text-[13px] text-[var(--ds-red)]">{printErr}</p>
          )}
        </div>
      )}

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
                className="group flex items-center gap-3 rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-3 transition-colors active:bg-[var(--color-muted)]/60"
              >
                <Checkbox
                  checked={selected.has(m.machineId)}
                  onChange={() => toggleSelected(m.machineId)}
                  aria-label={tb("selectMachine", {
                    name: m.displayName ?? t("noName"),
                  })}
                  disabled={printing}
                />
                {/* The chat shortcut is its own <a>, so the card body is
                    the link — nesting anchors is invalid HTML. */}
                <Link
                  href={`/admin/machines/${m.machineId}`}
                  className="min-w-0 flex-1"
                >
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
                </Link>
                <a
                  href={`/?account=${encodeURIComponent(m.accountId)}&machine=${encodeURIComponent(m.machineId)}`}
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
                <DataTableHeader className="w-10">
                  <Checkbox
                    checked={allInViewSelected}
                    indeterminate={!allInViewSelected && selectedInView > 0}
                    onChange={toggleAllInView}
                    aria-label={
                      allInViewSelected ? tb("deselectAll") : tb("selectAll")
                    }
                    disabled={printing}
                  />
                </DataTableHeader>
                <DataTableHeader>
                  <SortButton
                    active={sort.key === "name"}
                    dir={sort.dir}
                    onClick={() => toggleSort("name")}
                  >
                    {t("colName")}
                  </SortButton>
                </DataTableHeader>
                <DataTableHeader>{t("colAccount")}</DataTableHeader>
                <DataTableHeader>{t("colFactory")}</DataTableHeader>
                <DataTableHeader align="right">
                  <SortButton
                    active={sort.key === "documents"}
                    dir={sort.dir}
                    onClick={() => toggleSort("documents")}
                  >
                    {t("colDocuments")}
                  </SortButton>
                </DataTableHeader>
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
                      href={`/admin/machines/${m.machineId}`}
                    >
                      <DataTableCell>
                        {/* Stop the click before it reaches the row link. */}
                        <span
                          className="inline-flex"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Checkbox
                            checked={selected.has(m.machineId)}
                            onChange={() => toggleSelected(m.machineId)}
                            aria-label={tb("selectMachine", {
                              name: m.displayName ?? t("noName"),
                            })}
                            disabled={printing}
                          />
                        </span>
                      </DataTableCell>
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
