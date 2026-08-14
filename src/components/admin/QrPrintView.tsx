"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Download } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Breadcrumbs, type Crumb } from "@/components/admin/Breadcrumbs";
import { getAdminMachine, type AdminMachineDetail } from "@/admin/adminApi";
import { downloadQrStickerPng, renderQrStickerPngUrl } from "@/admin/qrSticker";

export function QrPrintView({ machineId }: { machineId: string }) {
  const t = useTranslations("admin.qrPrint");
  const tc = useTranslations("common");
  const tn = useTranslations("admin.nav.crumbs");
  const tSections = useTranslations("admin.nav.sections");
  const [data, setData] = useState<AdminMachineDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAdminMachine(machineId)
      .then((d) => {
        if (cancelled) return;
        setData(d);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : tc("unknownError"));
      });
    return () => {
      cancelled = true;
    };
  }, [machineId]);

  const qrToken = data?.qrToken ?? null;
  const machineName = data?.displayName ?? t("noName");
  const url =
    qrToken && typeof window !== "undefined"
      ? `${window.location.origin}/?qr=${encodeURIComponent(qrToken)}`
      : "";

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- revoking the
       object URL is the external-system sync this effect exists for */
    if (!url) {
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      return;
    }
    let cancelled = false;
    setPreviewError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    renderQrStickerPngUrl({ machineName, qrUrl: url })
      .then((objectUrl) => {
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        setPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return objectUrl;
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPreviewError(
          err instanceof Error ? err.message : tc("unknownError"),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [url, machineName, tc]);

  useEffect(() => {
    return () => {
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, []);

  const machineHref = `/admin/machines/${encodeURIComponent(machineId)}`;
  const breadcrumbs: Crumb[] = [
    { label: tSections("machines"), href: "/admin/machines" },
    {
      label: data?.displayName ?? tn("loading"),
      loading: !data,
      href: machineHref,
    },
    { label: tn("qr") },
  ];

  if (error) {
    return (
      <div className="mx-auto flex max-w-[700px] flex-col gap-5 p-4 sm:p-12">
        <Breadcrumbs items={breadcrumbs} />
        <div className="rounded-[4px] border border-[var(--ds-tag-red-dark)] bg-[var(--ds-tag-red-light)] p-6 text-[14px] text-[var(--ds-red-dark)]">
          {error}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto flex max-w-[700px] flex-col gap-5 p-4 sm:p-12">
        <Breadcrumbs items={breadcrumbs} />
        <div className="flex h-64 items-center justify-center">
          <Spinner className="h-5 w-5" />
        </div>
      </div>
    );
  }

  if (!data.qrToken) {
    return (
      <div className="mx-auto flex max-w-[700px] flex-col gap-5 p-4 sm:p-12">
        <Breadcrumbs items={breadcrumbs} />
        <div className="rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-6 text-center text-[14px]">
          <p>{t("noActive")}</p>
          <Link
            href={machineHref}
            className="mt-4 inline-flex items-center gap-1.5 text-[var(--color-brand)] hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t("backToMachine")}
          </Link>
        </div>
      </div>
    );
  }

  async function onDownload() {
    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadQrStickerPng({ machineName, qrUrl: url });
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : tc("unknownError"));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-[700px] flex-col items-stretch gap-5 p-4 sm:gap-8 sm:p-12">
      <div className="flex w-full items-center justify-between gap-3">
        <Breadcrumbs items={breadcrumbs} />
        <Button
          size="sm"
          onClick={() => void onDownload()}
          disabled={downloading || !previewUrl}
        >
          {downloading ? (
            <Spinner className="mr-1.5 h-4 w-4" />
          ) : (
            <Download className="mr-1.5 h-4 w-4" />
          )}
          {t("download")}
        </Button>
      </div>

      <div className="flex w-full items-center justify-center rounded-[4px] bg-[var(--color-muted)] p-4 sm:p-6">
        {previewUrl ? (
          <img
            src={previewUrl}
            alt={machineName}
            className="h-auto w-full max-w-[500px] rounded-[4px] bg-white shadow-sm"
          />
        ) : previewError ? (
          <p className="text-[13px] text-red-600">{previewError}</p>
        ) : (
          <div className="flex h-64 items-center justify-center">
            <Spinner className="h-5 w-5" />
          </div>
        )}
      </div>

      <p className="max-w-md break-all rounded-[4px] bg-[var(--color-muted)] px-3 py-2 text-center font-mono text-[11px] text-[var(--color-muted-foreground)]">
        {url}
      </p>

      {downloadError && (
        <p className="text-[13px] text-red-600">{downloadError}</p>
      )}

      <p className="max-w-md text-center text-[12px] text-[var(--color-muted-foreground)]">
        {t("pngHint")}
      </p>
    </div>
  );
}
