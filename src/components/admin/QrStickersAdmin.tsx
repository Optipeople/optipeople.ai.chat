"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
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
  listQrStickerBatches,
  lookupQrSticker,
} from "@/admin/adminApi";
import { getAccounts } from "@/auth/accountsApi";
import type { QrSticker, QrStickerBatch } from "@/lib/qrStickerTypes";
import { NewQrStickerBatchDialog } from "@/components/admin/NewQrStickerBatchDialog";
import {
  StickerTable,
  SuperAdminOnly,
  formatStickerCode,
  useShortDate,
} from "@/components/admin/QrStickerShared";
import { QrSheetPrintDrawer } from "@/components/admin/QrSheetPrintDrawer";

// /admin/qr-stickers: batches of pre-printed pool stickers. Super admins
// only; AdminGate already handled the logged-out and non-admin cases.
export function QrStickersAdmin() {
  return (
    <SuperAdminOnly>
      <QrStickersAdminInner />
    </SuperAdminOnly>
  );
}

function QrStickersAdminInner() {
  const t = useTranslations("admin.qrStickers");
  const tErr = useTranslations("admin.apiErrors");
  const tc = useTranslations("common");
  const router = useRouter();
  const shortDate = useShortDate();
  const [batches, setBatches] = useState<QrStickerBatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accountNames, setAccountNames] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [newOpen, setNewOpen] = useState(false);
  const [csvSheetOpen, setCsvSheetOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listQrStickerBatches()
      .then((res) => {
        if (cancelled) return;
        setBatches(
          [...res.batches].sort((a, b) =>
            b.createdAt.localeCompare(a.createdAt),
          ),
        );
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(adminErrorMessage(err, tErr) ?? tc("unknownError"));
      });
    return () => {
      cancelled = true;
    };
  }, [tErr, tc]);

  // Best effort: fall back to showing the account ID.
  useEffect(() => {
    let cancelled = false;
    getAccounts()
      .then((rows) => {
        if (!cancelled) {
          setAccountNames(new Map(rows.map((a) => [a.id, a.name])));
        }
      })
      .catch(() => {
        /* fall back to IDs */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function accountLabel(id: string | null): string {
    if (!id) return t("globalPool");
    return accountNames.get(id) ?? id;
  }

  const loading = batches === null && !error;

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
              : t("batchCount", { count: batches?.length ?? 0 })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 self-start sm:self-auto">
          <Button
            variant="secondary"
            size="compact"
            onClick={() => setCsvSheetOpen(true)}
          >
            {t("printSheetsCsv")}
          </Button>
          <Button
            variant="secondary"
            size="compact"
            onClick={() => setNewOpen(true)}
          >
            {t("newBatch")}
          </Button>
        </div>
      </div>

      <QrSheetPrintDrawer
        open={csvSheetOpen}
        onClose={() => setCsvSheetOpen(false)}
        stickers={null}
        fileBase="qr-stickers-csv"
      />

      <FindStickerByCode />

      <hr className="my-2 border-0 border-t border-[var(--ds-grey-light-02)]" />

      {newOpen && (
        <NewQrStickerBatchDialog
          onClose={() => setNewOpen(false)}
          onCreated={(batch) => {
            setNewOpen(false);
            router.push(`/admin/qr-stickers/${encodeURIComponent(batch.id)}`);
          }}
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
      ) : !batches || batches.length === 0 ? (
        <div className="rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-10 text-center text-[14px] text-[var(--color-muted-foreground)]">
          {t("emptyBatches")}
        </div>
      ) : (
        <>
          {/* Mobile card list */}
          <div className="flex flex-col gap-2 sm:hidden">
            {batches.map((b) => (
              <Link
                key={b.id}
                href={`/admin/qr-stickers/${encodeURIComponent(b.id)}`}
                className="group flex items-center gap-3 rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-3 transition-colors active:bg-[var(--color-muted)]/60"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium text-[var(--color-foreground)]">
                    {b.label}
                  </p>
                  <p className="mt-0.5 truncate text-[12px] text-[var(--color-muted-foreground)]">
                    {accountLabel(b.accountId)}
                  </p>
                  <p className="mt-1.5 text-[12px] text-[var(--color-muted-foreground)]">
                    {t("batchSummary", {
                      count: b.count,
                      linked: b.linkedCount,
                      retired: b.retiredCount,
                    })}
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
                <DataTableHeader>{t("colLabel")}</DataTableHeader>
                <DataTableHeader>{t("colAccount")}</DataTableHeader>
                <DataTableHeader align="right">{t("colCount")}</DataTableHeader>
                <DataTableHeader align="right">
                  {t("colLinked")}
                </DataTableHeader>
                <DataTableHeader align="right">
                  {t("colRetired")}
                </DataTableHeader>
                <DataTableHeader>{t("colCreated")}</DataTableHeader>
                <DataTableHeader className="w-10" />
              </DataTableHead>
              <DataTableBody>
                {batches.map((b) => (
                  <DataTableRow
                    key={b.id}
                    href={`/admin/qr-stickers/${encodeURIComponent(b.id)}`}
                  >
                    <DataTableCell className="group-hover:underline">
                      {b.label}
                    </DataTableCell>
                    <DataTableCell>{accountLabel(b.accountId)}</DataTableCell>
                    <DataTableCell align="right" className="tabular-nums">
                      {b.count}
                    </DataTableCell>
                    <DataTableCell align="right" className="tabular-nums">
                      {b.linkedCount}
                    </DataTableCell>
                    <DataTableCell align="right" className="tabular-nums">
                      {b.retiredCount}
                    </DataTableCell>
                    <DataTableCell>{shortDate(b.createdAt)}</DataTableCell>
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

// Lets an admin type the code printed under a sticker and see where it is.
function FindStickerByCode() {
  const t = useTranslations("admin.qrStickers");
  const tErr = useTranslations("admin.apiErrors");
  const tc = useTranslations("common");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<QrSticker | null>(null);

  async function find() {
    const normalized = formatStickerCode(code);
    if (!normalized || busy) return;
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const res = await lookupQrSticker({ code: normalized });
      setResult(res.sticker);
    } catch (e) {
      setErr(adminErrorMessage(e, tErr) ?? tc("unknownError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void find();
        }}
      >
        <div className="w-full sm:w-80">
          <TextField
            label={t("findLabel")}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={t("codePlaceholder")}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <Button
          type="submit"
          variant="secondary"
          size="compact"
          disabled={busy || !code.trim()}
        >
          {busy ? (
            <Spinner className="mr-1.5 h-4 w-4" />
          ) : (
            <Search className="mr-1.5 h-4 w-4" />
          )}
          {t("findSubmit")}
        </Button>
      </form>
      {err && <p className="text-[13px] text-[var(--ds-red)]">{err}</p>}
      {result && (
        <StickerTable
          stickers={[result]}
          onUpdated={setResult}
          showBatch
        />
      )}
    </div>
  );
}
