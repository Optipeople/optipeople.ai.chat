"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Download, Loader2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { OptipeopleLogo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { getAdminMachine, type AdminMachineDetail } from "@/admin/adminApi";
import { downloadQrStickerPng } from "@/admin/qrSticker";

export function QrPrintView({ machineId }: { machineId: string }) {
  const [data, setData] = useState<AdminMachineDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAdminMachine(machineId)
      .then((d) => {
        if (cancelled) return;
        setData(d);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Ukendt fejl");
      });
    return () => {
      cancelled = true;
    };
  }, [machineId]);

  if (error) {
    return (
      <div className="mx-auto mt-12 max-w-md rounded-[4px] border border-[var(--ds-tag-red-dark)] bg-[var(--ds-tag-red-light)] p-6 text-[14px] text-[var(--ds-red-dark)]">
        {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--color-muted-foreground)]" />
      </div>
    );
  }

  if (!data.qrToken) {
    return (
      <div className="mx-auto mt-12 max-w-md rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-6 text-center text-[14px]">
        <p>Der er ingen aktiv QR-kode for denne maskine.</p>
        <Link
          href={`/admin/machines/${machineId}`}
          className="mt-4 inline-flex items-center gap-1.5 text-[var(--color-brand)] hover:underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Tilbage til maskinen
        </Link>
      </div>
    );
  }

  const url =
    typeof window !== "undefined"
      ? `${window.location.origin}/?qr=${encodeURIComponent(data.qrToken)}`
      : "";
  const machineName = data.displayName ?? "(uden navn)";

  async function onDownload() {
    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadQrStickerPng({ machineName, qrUrl: url });
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Ukendt fejl");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-[700px] flex-col items-center gap-8 p-12">
      <div className="flex w-full items-center justify-between">
        <Link
          href={`/admin/machines/${machineId}`}
          className="inline-flex items-center gap-1.5 text-[13px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Tilbage
        </Link>
        <Button
          size="sm"
          onClick={() => void onDownload()}
          disabled={downloading}
        >
          {downloading ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-1.5 h-4 w-4" />
          )}
          Download
        </Button>
      </div>

      {/* On-screen preview — visually mirrors the rendered PNG so the
          user can confirm the sticker looks right before downloading. */}
      <div className="flex w-full flex-col items-center gap-6 rounded-[4px] border-2 border-[var(--color-foreground)] bg-white p-10 text-center">
        <OptipeopleLogo
          className="h-10 w-auto text-[var(--color-foreground)]"
          aria-label="Optipeople"
        />

        <div className="flex flex-col gap-1">
          <p className="text-[18px] uppercase tracking-[0.2em] text-[var(--color-muted-foreground)]">
            Scan & spørg
          </p>
          <h1 className="text-[36px] font-semibold leading-tight tracking-tight text-[var(--color-foreground)]">
            {machineName}
          </h1>
        </div>

        <div className="rounded-[4px] bg-white p-4">
          <QRCodeSVG value={url} size={320} level="M" includeMargin />
        </div>

        <p className="max-w-md text-[16px] leading-relaxed text-[var(--color-foreground)]">
          Scan koden med kameraet på din telefon og stil dit spørgsmål
          direkte til OptiAI for denne maskine.
        </p>
      </div>

      <p className="max-w-md break-all rounded-[4px] bg-[var(--color-muted)] px-3 py-2 text-center font-mono text-[11px] text-[var(--color-muted-foreground)]">
        {url}
      </p>

      {downloadError && (
        <p className="text-[13px] text-red-600">{downloadError}</p>
      )}

      <p className="max-w-md text-center text-[12px] text-[var(--color-muted-foreground)]">
        PNG&#39;en er 1200×1500 px — egnet til print på A6 etiket eller
        indsætning i Word-dokumenter inden printet.
      </p>
    </div>
  );
}
