"use client";

import { useEffect, useMemo, useState } from "react";
import { Ban, Download, FileText } from "lucide-react";
import { useTranslations } from "next-intl";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Breadcrumbs, type Crumb } from "@/components/admin/Breadcrumbs";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  adminErrorMessage,
  getQrStickerBatch,
  retireQrStickers,
} from "@/admin/adminApi";
import { getAccounts } from "@/auth/accountsApi";
import {
  downloadStickerCsv,
  downloadStickerPdf,
  stickerUrl,
} from "@/admin/qrStickerPdf";
import type {
  QrSticker,
  QrStickerBatch,
  QrStickerStatus,
} from "@/lib/qrStickerTypes";
import {
  POOL_STICKER_NAME,
  StickerTable,
  SuperAdminOnly,
  formatStickerCode,
  useShortDate,
} from "@/components/admin/QrStickerShared";

export function QrStickerBatchDetail({ batchId }: { batchId: string }) {
  return (
    <SuperAdminOnly>
      <BatchDetailInner batchId={batchId} />
    </SuperAdminOnly>
  );
}

// Filename-safe slug of the batch label, so downloads are recognisable.
function fileSlug(label: string, fallback: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

function BatchDetailInner({ batchId }: { batchId: string }) {
  const t = useTranslations("admin.qrStickers");
  const tErr = useTranslations("admin.apiErrors");
  const tc = useTranslations("common");
  const tq = useTranslations("admin.qrPrint");
  const tn = useTranslations("admin.nav.crumbs");
  const tSections = useTranslations("admin.nav.sections");
  const shortDate = useShortDate();
  const [batch, setBatch] = useState<QrStickerBatch | null>(null);
  const [stickers, setStickers] = useState<QrSticker[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [accountName, setAccountName] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<QrStickerStatus | "">("");
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [downloadErr, setDownloadErr] = useState<string | null>(null);
  const tb = useTranslations("admin.qrStickers.bulkPrint");
  const tr = useTranslations("admin.qrStickers.bulkRetire");
  const confirm = useConfirm();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [retiring, setRetiring] = useState(false);
  const [retireErr, setRetireErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getQrStickerBatch(batchId)
      .then((res) => {
        if (cancelled) return;
        setBatch(res.batch);
        setStickers(
          [...res.stickers].sort((a, b) => a.code.localeCompare(b.code)),
        );
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(adminErrorMessage(err, tErr) ?? tc("unknownError"));
      });
    return () => {
      cancelled = true;
    };
  }, [batchId, tErr, tc]);

  const accountId = batch?.accountId ?? null;
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    getAccounts()
      .then((rows) => {
        if (cancelled) return;
        setAccountName(rows.find((a) => a.id === accountId)?.name ?? null);
      })
      .catch(() => {
        /* fall back to the ID */
      });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  const visible = useMemo(
    () =>
      statusFilter ? stickers.filter((s) => s.status === statusFilter) : stickers,
    [stickers, statusFilter],
  );

  // Retired stickers are out of circulation, so they are never reprinted.
  const printable = useMemo(
    () => stickers.filter((s) => s.status !== "retired"),
    [stickers],
  );

  const counts = useMemo(() => {
    let linked = 0;
    let retired = 0;
    for (const s of stickers) {
      if (s.status === "linked") linked += 1;
      else if (s.status === "retired") retired += 1;
    }
    return { linked, retired };
  }, [stickers]);

  function onUpdated(updated: QrSticker) {
    setStickers((prev) =>
      prev.map((s) => (s.id === updated.id ? updated : s)),
    );
  }

  async function retireSelected() {
    const ids = stickers
      .filter((s) => selected.has(s.id) && s.status !== "retired")
      .map((s) => s.id);
    if (ids.length === 0 || retiring) return;
    const ok = await confirm({
      title: tr("confirmTitle", { count: ids.length }),
      description: tr("confirmBody"),
      confirmLabel: tr("confirmLabel"),
      danger: true,
    });
    if (!ok) return;
    setRetiring(true);
    setRetireErr(null);
    try {
      const res = await retireQrStickers(ids);
      const byId = new Map(res.stickers.map((s) => [s.id, s]));
      setStickers((prev) => prev.map((s) => byId.get(s.id) ?? s));
      setSelected(new Set());
    } catch (e) {
      setRetireErr(adminErrorMessage(e, tErr) ?? tc("unknownError"));
    } finally {
      setRetiring(false);
    }
  }

  const busy = progress !== null;
  const baseName = batch
    ? `qr-stickers-${fileSlug(batch.label, batch.id.slice(0, 8))}`
    : "qr-stickers";

  async function downloadPdf() {
    if (busy || printable.length === 0) return;
    setDownloadErr(null);
    setProgress({ done: 0, total: printable.length });
    try {
      const eyebrow = tq("scanAndAsk");
      const supportPhone = tc("supportPhone");
      const supportEmail = tc("supportEmail");
      await downloadStickerPdf(
        printable.map((s) => ({
          machineName: POOL_STICKER_NAME,
          qrUrl: stickerUrl(s.token),
          eyebrow,
          supportPhone,
          supportEmail,
          code: formatStickerCode(s.code),
        })),
        `${baseName}.pdf`,
        (done, total) => setProgress({ done, total }),
      );
    } catch (e) {
      setDownloadErr(e instanceof Error ? e.message : tc("unknownError"));
    } finally {
      setProgress(null);
    }
  }

  // Awaited in case the helper is async; harmless if it is not.
  async function downloadCsv() {
    if (printable.length === 0) return;
    setDownloadErr(null);
    try {
      await downloadStickerCsv(
        printable.map((s) => ({
          code: formatStickerCode(s.code),
          url: stickerUrl(s.token),
        })),
        `${baseName}.csv`,
      );
    } catch (e) {
      setDownloadErr(e instanceof Error ? e.message : tc("unknownError"));
    }
  }

  const breadcrumbs: Crumb[] = [
    { label: tSections("qrStickers"), href: "/admin/qr-stickers" },
    { label: batch?.label ?? tn("loading"), loading: !batch },
  ];

  if (error) {
    return (
      <div className="flex flex-col gap-5 sm:gap-6">
        <Breadcrumbs items={breadcrumbs} />
        <div className="rounded-[4px] border border-[var(--ds-tag-red-dark)] bg-[var(--ds-tag-red-light)] p-6 text-[14px] text-[var(--ds-red-dark)]">
          {error}
        </div>
      </div>
    );
  }

  if (!batch) {
    return (
      <div className="flex flex-col gap-5 sm:gap-6">
        <Breadcrumbs items={breadcrumbs} />
        <div className="flex h-32 items-center justify-center">
          <Spinner className="h-5 w-5" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      <Breadcrumbs items={breadcrumbs} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold tracking-tight text-[var(--color-foreground)] sm:text-[24px]">
            {batch.label}
          </h1>
          <p className="mt-1 text-[13px] text-[var(--color-muted-foreground)] sm:text-[14px]">
            {t("batchSummary", {
              count: stickers.length,
              linked: counts.linked,
              retired: counts.retired,
            })}
          </p>
          <p className="mt-0.5 text-[13px] text-[var(--color-muted-foreground)]">
            {t("batchMeta", {
              account: batch.accountId
                ? (accountName ?? batch.accountId)
                : t("globalPool"),
              date: shortDate(batch.createdAt) ?? "",
            })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 sm:shrink-0 sm:flex-nowrap">
          <Button
            size="sm"
            onClick={() => void downloadPdf()}
            disabled={busy || printable.length === 0}
          >
            {busy ? (
              <Spinner className="mr-1.5 h-4 w-4" />
            ) : (
              <Download className="mr-1.5 h-4 w-4" />
            )}
            {t("downloadPdf")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void downloadCsv()}
            disabled={busy || printable.length === 0}
          >
            <FileText className="mr-1.5 h-4 w-4" />
            {t("downloadCsv")}
          </Button>
        </div>
      </div>

      {progress && (
        <div className="flex flex-col gap-1.5">
          <ProgressBar
            value={
              progress.total > 0 ? (progress.done / progress.total) * 100 : 0
            }
          />
          <p className="text-[12px] text-[var(--color-muted-foreground)]">
            {t("pdfProgress", { done: progress.done, total: progress.total })}
          </p>
        </div>
      )}
      {downloadErr && (
        <p className="text-[13px] text-[var(--ds-red)]">{downloadErr}</p>
      )}
      {counts.retired > 0 && (
        <p className="text-[12px] text-[var(--color-muted-foreground)]">
          {t("retiredNotPrinted")}
        </p>
      )}

      <hr className="my-2 border-0 border-t border-[var(--ds-grey-light-02)]" />

      <div className="min-w-[160px] sm:w-[200px]">
        <Select
          label={t("filterStatus")}
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as QrStickerStatus | "")}
        >
          <option value="">{t("filterAll")}</option>
          <option value="unclaimed">{t("statusUnclaimed")}</option>
          <option value="linked">{t("statusLinked")}</option>
          <option value="retired">{t("statusRetired")}</option>
        </Select>
      </div>

      {(selected.size > 0 || retireErr) && (
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
                disabled={retiring}
              >
                {tb("clearSelection")}
              </Button>
              <Button
                variant="ghostDanger"
                size="pill"
                onClick={() => void retireSelected()}
                disabled={retiring}
              >
                {retiring ? (
                  <Spinner className="h-3.5 w-3.5" />
                ) : (
                  <Ban className="h-3.5 w-3.5" />
                )}
                {tr("retireSelected", { count: selected.size })}
              </Button>
            </div>
          )}
          {retireErr && (
            <p className="text-[13px] text-[var(--ds-red)]">{retireErr}</p>
          )}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-10 text-center text-[14px] text-[var(--color-muted-foreground)]">
          {t("emptyStickers")}
        </div>
      ) : (
        <StickerTable
          stickers={visible}
          onUpdated={onUpdated}
          selection={{
            selected,
            onChange: setSelected,
            disabled: retiring,
          }}
        />
      )}
    </div>
  );
}
