"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Printer } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { OptipeopleLogo } from "@/components/logo";
import { getAdminMachine, type AdminMachineDetail } from "@/admin/adminApi";

export function QrPrintView({ machineId }: { machineId: string }) {
  const [data, setData] = useState<AdminMachineDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      <div className="mx-auto mt-12 max-w-md rounded-[var(--radius)] border border-red-200 bg-red-50 p-6 text-[14px] text-red-700">
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
      <div className="mx-auto mt-12 max-w-md rounded-[var(--radius)] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-6 text-center text-[14px]">
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

  return (
    <>
      {/* Print sheet — A4-friendly, single page. The chrome above is
          hidden by the print stylesheet below. */}
      <div className="qr-print mx-auto flex max-w-[700px] flex-col items-center gap-8 p-12">
        <div className="qr-screen-only flex w-full items-center justify-between">
          <Link
            href={`/admin/machines/${machineId}`}
            className="inline-flex items-center gap-1.5 text-[13px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Tilbage
          </Link>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-[var(--radius)] bg-[var(--color-brand)] px-4 py-2 text-[13px] font-medium text-white shadow-[var(--shadow-sm)] hover:opacity-90"
          >
            <Printer className="h-4 w-4" />
            Print
          </button>
        </div>

        <div className="flex w-full flex-col items-center gap-6 rounded-[var(--radius-lg)] border-2 border-[var(--color-foreground)] bg-white p-10 text-center">
          <OptipeopleLogo
            className="h-10 w-auto text-[var(--color-foreground)]"
            aria-label="Optipeople"
          />

          <div className="flex flex-col gap-1">
            <p className="text-[18px] uppercase tracking-[0.2em] text-[var(--color-muted-foreground)]">
              Scan & spørg
            </p>
            <h1 className="text-[36px] font-semibold leading-tight tracking-tight text-[var(--color-foreground)]">
              {data.displayName ?? "(uden navn)"}
            </h1>
          </div>

          <div className="rounded-[var(--radius)] bg-white p-4">
            <QRCodeSVG value={url} size={320} level="M" includeMargin />
          </div>

          <p className="max-w-md text-[16px] leading-relaxed text-[var(--color-foreground)]">
            Scan koden med kameraet på din telefon og stil dit spørgsmål
            direkte til OptiAI for denne maskine.
          </p>

          <p className="qr-screen-only max-w-md break-all rounded-[var(--radius)] bg-[var(--color-muted)] px-3 py-2 font-mono text-[11px] text-[var(--color-muted-foreground)]">
            {url}
          </p>
        </div>
      </div>

      <style>{`
        @media print {
          /* Hide every chrome element on the page (admin nav, sidebar,
             back/print buttons) — leave only the printable card. */
          body * { visibility: hidden; }
          .qr-print, .qr-print * { visibility: visible; }
          .qr-print { position: absolute; left: 0; top: 0; width: 100%; padding: 0; }
          .qr-screen-only { display: none !important; }
          /* Page setup: portrait A4, no browser headers/footers if the
             print dialog respects @page (most do). */
          @page { size: A4; margin: 12mm; }
        }
      `}</style>
    </>
  );
}
