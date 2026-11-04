"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Printer, Upload, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { IconButton } from "@/components/ui/icon-button";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { TextField } from "@/components/ui/text-field";
import { Textarea } from "@/components/ui/textarea";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { cn } from "@/lib/utils";
import { triggerDownload, type QrStickerArgs } from "@/admin/qrSticker";
import {
  DEFAULT_SHEET_OPTIONS,
  LABELS_PER_SHEET,
  buildSheetPdf,
  clampBleed,
  drawSheetPreview,
  layoutSheets,
  parseStickerCsv,
  type SheetOptions,
  type SheetSlot,
} from "@/admin/qrSheetPdf";
import { POOL_STICKER_NAME } from "@/components/admin/QrStickerShared";

// One sticker to print, as the batch page or a CSV row gives it.
export type SheetSticker = {
  code: string;
  url: string;
  // Machine name of a linked sticker; used as title when the admin asks.
  machineName?: string | null;
};

// Print page for Avery 90x120-R label sheets. Slides in from the right
// over the QR sticker pages: settings on the left, a live preview of the
// sheets on the right, and the PDF is built only when the admin asks.
//
// With `stickers` it prints those (the batch page passes the ticked
// stickers, or the whole batch); with `stickers === null` it takes a CSV.
export function QrSheetPrintDrawer({
  open,
  onClose,
  stickers,
  summary,
  fileBase,
}: {
  open: boolean;
  onClose: () => void;
  stickers: SheetSticker[] | null;
  // One line on what is being printed, e.g. "Hele batchen: 10 stickers".
  summary?: string;
  // Download name without extension.
  fileBase: string;
}) {
  const t = useTranslations("admin.qrStickers.sheet");
  const tq = useTranslations("admin.qrPrint");
  const tc = useTranslations("common");

  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, open);
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      // An open Select menu handles its own Escape (and marks it handled).
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Text on the sticker.
  const [eyebrow, setEyebrow] = useState(() => tq("scanAndAsk"));
  const [title, setTitle] = useState(POOL_STICKER_NAME);
  const [phone, setPhone] = useState(() => tc("supportPhone"));
  const [email, setEmail] = useState(() => tc("supportEmail"));
  const [useMachineName, setUseMachineName] = useState(false);

  // Sheet. The printer correction is per browser, so it is remembered.
  const [startSlot, setStartSlot] = useState("0");
  const [copiesText, setCopiesText] = useState("1");
  const [offsetXText, setOffsetXText] = usePersisted("qr-sheet-offset-x", "0");
  const [offsetYText, setOffsetYText] = usePersisted("qr-sheet-offset-y", "0");
  const [bleedText, setBleedText] = usePersisted("qr-sheet-bleed", String(DEFAULT_SHEET_OPTIONS.bleed));
  const [outline, setOutline] = useState(false);

  // CSV source.
  const [csvText, setCsvText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const options: SheetOptions = useMemo(
    () => ({
      startSlot: Number(startSlot) || 0,
      offsetX: toNumber(offsetXText),
      offsetY: toNumber(offsetYText),
      bleed: clampBleed(toNumber(bleedText)),
      outline,
    }),
    [startSlot, offsetXText, offsetYText, bleedText, outline],
  );
  const copies = Math.min(10, Math.max(1, Math.floor(toNumber(copiesText)) || 1));

  const csv = useMemo(() => {
    if (stickers !== null) return { rows: [], error: null as string | null };
    try {
      return { rows: parseStickerCsv(csvText), error: null };
    } catch {
      return { rows: [], error: t("csvNoUrl") };
    }
  }, [stickers, csvText, t]);

  const hasLinked = !!stickers?.some((s) => s.machineName);

  const items: QrStickerArgs[] = useMemo(() => {
    const base =
      stickers !== null
        ? stickers.map((s) => ({
            code: s.code,
            url: s.url,
            name: useMachineName && s.machineName ? s.machineName : "",
          }))
        : csv.rows;
    const out: QrStickerArgs[] = [];
    for (const s of base) {
      const args: QrStickerArgs = {
        machineName: s.name || title,
        qrUrl: s.url,
        eyebrow,
        supportPhone: phone,
        supportEmail: email,
        code: s.code,
      };
      for (let i = 0; i < copies; i++) out.push(args);
    }
    return out;
  }, [stickers, csv.rows, useMachineName, title, eyebrow, phone, email, copies]);

  const sheets = useMemo(() => layoutSheets(items, options.startSlot), [items, options.startSlot]);
  const busy = progress !== null;

  async function onFile(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    setCsvText(await f.text());
    if (fileRef.current) fileRef.current.value = "";
  }

  async function download(testOnly: boolean) {
    if (busy) return;
    setError(null);
    setProgress({ done: 0, total: testOnly ? LABELS_PER_SHEET : items.length });
    try {
      const blob = await buildSheetPdf(items, options, {
        testOnly,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      triggerDownload(blob, testOnly ? "test-sheet-avery-90x120.pdf" : `${fileBase}-avery-90x120.pdf`);
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("unknownError"));
    } finally {
      setProgress(null);
    }
  }

  return (
    <div
      className={cn("fixed inset-0 z-40", open ? "pointer-events-auto" : "pointer-events-none")}
      aria-hidden={!open}
    >
      <div
        onClick={onClose}
        aria-hidden
        className={cn(
          "absolute inset-0 bg-black/30 transition-opacity ease-out",
          open ? "opacity-100 duration-200" : "opacity-0 duration-150",
        )}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal={open}
        aria-labelledby="qr-sheet-title"
        className={cn(
          "absolute bottom-0 right-0 top-0 flex w-[1040px] max-w-full flex-col",
          "bg-[var(--color-surface)] shadow-[var(--shadow-md)]",
          "transition-[transform,visibility] duration-[220ms] ease-out",
          open ? "visible translate-x-0" : "invisible translate-x-full",
        )}
      >
        <header className="flex items-start justify-between gap-3 border-b border-[var(--ds-grey-light-02)] px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2
              id="qr-sheet-title"
              className="text-[18px] font-semibold tracking-tight text-[var(--color-foreground)]"
            >
              {t("title")}
            </h2>
            <p className="mt-0.5 text-[13px] text-[var(--color-muted-foreground)]">
              {t("subtitle")}
            </p>
          </div>
          <IconButton aria-label={tc("close")} onClick={onClose}>
            <X className="h-5 w-5" />
          </IconButton>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[340px_1fr] md:overflow-hidden">
          <div className="flex flex-col gap-5 border-[var(--ds-grey-light-02)] px-5 py-5 md:overflow-y-auto md:border-r sm:px-6">
            <section className="flex flex-col gap-2">
              <SectionHeading>{t("sectionStickers")}</SectionHeading>
              {stickers !== null ? (
                <>
                  <p className="text-[14px] text-[var(--color-foreground)]">{summary}</p>
                  {hasLinked && (
                    <Checkbox
                      label={t("useMachineName")}
                      checked={useMachineName}
                      onChange={(e) => setUseMachineName(e.target.checked)}
                    />
                  )}
                </>
              ) : (
                <>
                  <div>
                    <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
                      <Upload className="mr-1.5 h-4 w-4" />
                      {t("csvChoose")}
                    </Button>
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".csv,text/csv"
                      className="hidden"
                      onChange={(e) => void onFile(e.target.files)}
                    />
                  </div>
                  <Textarea
                    label={t("csvPaste")}
                    rows={5}
                    value={csvText}
                    onChange={(e) => setCsvText(e.target.value)}
                    spellCheck={false}
                    validation={csv.error ? "error" : "none"}
                    helpText={csv.error ?? t("csvHelp")}
                  />
                </>
              )}
            </section>

            <section className="flex flex-col gap-2">
              <SectionHeading>{t("sectionText")}</SectionHeading>
              <TextField label={t("eyebrow")} value={eyebrow} onChange={(e) => setEyebrow(e.target.value)} />
              <TextField label={t("stickerTitle")} value={title} onChange={(e) => setTitle(e.target.value)} />
              <div className="grid grid-cols-2 gap-2">
                <TextField label={t("phone")} value={phone} onChange={(e) => setPhone(e.target.value)} />
                <TextField label={t("email")} value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
            </section>

            <section className="flex flex-col gap-2">
              <SectionHeading>{t("sectionSheet")}</SectionHeading>
              <div className="grid grid-cols-2 gap-2">
                <Select label={t("startSlot")} value={startSlot} onValueChange={setStartSlot}>
                  <option value="0">{t("slot1")}</option>
                  <option value="1">{t("slot2")}</option>
                  <option value="2">{t("slot3")}</option>
                  <option value="3">{t("slot4")}</option>
                </Select>
                <TextField
                  label={t("copies")}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={10}
                  step={1}
                  value={copiesText}
                  onChange={(e) => setCopiesText(e.target.value)}
                />
              </div>
              <Hint>{t("startSlotHelp")}</Hint>
            </section>

            <section className="flex flex-col gap-2">
              <SectionHeading>{t("sectionPrinter")}</SectionHeading>
              <div className="grid grid-cols-2 gap-2">
                <TextField
                  label={t("offsetX")}
                  type="number"
                  step={0.1}
                  value={offsetXText}
                  onChange={(e) => setOffsetXText(e.target.value)}
                />
                <TextField
                  label={t("offsetY")}
                  type="number"
                  step={0.1}
                  value={offsetYText}
                  onChange={(e) => setOffsetYText(e.target.value)}
                />
              </div>
              <Hint>{t("offsetHelp")}</Hint>
              <TextField
                label={t("bleed")}
                type="number"
                min={0}
                max={2.5}
                step={0.5}
                value={bleedText}
                onChange={(e) => setBleedText(e.target.value)}
              />
              <Hint>{t("bleedHelp")}</Hint>
              <Checkbox
                label={t("outline")}
                checked={outline}
                onChange={(e) => setOutline(e.target.checked)}
              />
            </section>

            <Hint>{t("printHint")}</Hint>
          </div>

          <div className="bg-[var(--color-muted)] p-4 md:overflow-y-auto sm:p-5">
            {open && <SheetPreview sheets={sheets} options={options} />}
          </div>
        </div>

        <footer className="flex flex-col gap-2 border-t border-[var(--ds-grey-light-02)] px-5 py-3 sm:px-6">
          {progress && (
            <ProgressBar value={progress.total > 0 ? (progress.done / progress.total) * 100 : 0} />
          )}
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-[180px] flex-1 text-[13px] text-[var(--color-muted-foreground)]">
              {error ? (
                <span className="text-[var(--ds-red)]">{error}</span>
              ) : progress ? (
                t("progress", { done: progress.done, total: progress.total })
              ) : items.length ? (
                t("count", { labels: items.length, sheets: sheets.length })
              ) : (
                t("empty")
              )}
            </p>
            <Button variant="secondary" size="sm" onClick={() => void download(true)} disabled={busy}>
              <FileText className="mr-1.5 h-4 w-4" />
              {t("testSheet")}
            </Button>
            <Button size="sm" onClick={() => void download(false)} disabled={busy || items.length === 0}>
              {busy ? <Spinner className="mr-1.5 h-4 w-4" /> : <Printer className="mr-1.5 h-4 w-4" />}
              {t("buildPdf")}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}

const PREVIEW_SHEETS = 6;
const PREVIEW_PX_PER_MM = 1.3;

// Live preview of the first sheets, redrawn shortly after the settings
// settle so typing in a field does not re-render every sticker per key.
function SheetPreview({
  sheets,
  options,
}: {
  sheets: SheetSlot<QrStickerArgs>[][];
  options: SheetOptions;
}) {
  const t = useTranslations("admin.qrStickers.sheet");
  const shown = sheets.slice(0, PREVIEW_SHEETS);
  const refs = useRef<(HTMLCanvasElement | null)[]>([]);
  const [drawing, setDrawing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;
    const timer = setTimeout(async () => {
      setDrawing(true);
      try {
        for (let i = 0; i < shown.length; i++) {
          if (cancelled) return;
          const canvas = refs.current[i];
          if (canvas) {
            await drawSheetPreview(canvas, shown[i], options, PREVIEW_PX_PER_MM * 2, isCancelled);
          }
        }
      } catch (e) {
        // A preview failure (e.g. a URL too long for a QR code) must not
        // break the page; the PDF button reports the same error properly.
        console.warn("QR sheet preview failed", e);
      } finally {
        if (!cancelled) setDrawing(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // shown is derived from sheets; redraw when sheets or options change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheets, options]);

  if (!shown.length) {
    return (
      <div className="flex h-40 items-center justify-center text-[14px] text-[var(--color-muted-foreground)]">
        {t("empty")}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start gap-4">
        {shown.map((sheet, i) => (
          <figure key={i} className="m-0 rounded-[2px] bg-white shadow-[var(--shadow-md)]">
            <canvas
              ref={(el) => {
                refs.current[i] = el;
              }}
              aria-label={t("sheetOf", { n: i + 1, total: sheets.length })}
              style={{ width: `${210 * PREVIEW_PX_PER_MM}px`, aspectRatio: "210 / 297" }}
              className="block h-auto"
            />
            <figcaption className="px-2 py-1 text-[12px] text-[var(--color-muted-foreground)]">
              {t("sheetOf", { n: i + 1, total: sheets.length })}
            </figcaption>
          </figure>
        ))}
      </div>
      <p className="flex items-center gap-2 text-[12px] text-[var(--color-muted-foreground)]">
        {drawing && <Spinner className="h-3.5 w-3.5" />}
        {sheets.length > shown.length && t("moreSheets", { count: sheets.length - shown.length })}
      </p>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
      {children}
    </h3>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] leading-[18px] text-[var(--color-muted-foreground)]">{children}</p>;
}

function toNumber(text: string): number {
  const n = Number(text.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

// useState that is remembered in localStorage (printer correction belongs
// to the printer next to this browser, not to the batch).
function usePersisted(key: string, fallback: string): [string, (v: string) => void] {
  const [value, setValue] = useState(() => {
    if (typeof window === "undefined") return fallback;
    try {
      return window.localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  });
  function set(v: string) {
    setValue(v);
    try {
      window.localStorage.setItem(key, v);
    } catch {
      /* private mode: keep it for this session only */
    }
  }
  return [value, set];
}
