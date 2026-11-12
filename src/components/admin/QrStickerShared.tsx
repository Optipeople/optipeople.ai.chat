"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { Ban, Unlink } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  Spinner,
  Button,
  Checkbox,
  Tag,
  type TagVariant,
  useConfirm,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@optipeople/ui";
import { isSuperAdmin, useAuth } from "@/auth/AuthContext";
import { adminErrorMessage, updateQrSticker } from "@/admin/adminApi";
import type { QrSticker, QrStickerStatus } from "@/lib/qrStickerTypes";

// Helpers shared by the QR sticker admin screens, the machine QR card and
// the machine list bulk print.

// Pool stickers carry this name instead of a machine name, since they are
// printed before anyone knows which machine they will end up on.
export const POOL_STICKER_NAME = "Opti Assist";

// Codes are printed as XXXX-XXXX. Normalise whatever the server or the
// admin typed into that shape so display and lookups agree.
export function formatStickerCode(code: string): string {
  const raw = code.replace(/[^0-9a-z]/gi, "").toUpperCase();
  return raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
}

// Locale-aware short date, same format as the machine detail screens.
export function useShortDate(): (iso: string | null) => string | null {
  const locale = useLocale();
  const fmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        year: "numeric",
        month: "short",
        day: "numeric",
      }),
    [locale],
  );
  return (iso) => (iso ? fmt.format(new Date(iso)) : null);
}

const STATUS_VARIANT: Record<QrStickerStatus, TagVariant> = {
  unclaimed: "default",
  linked: "positive",
  retired: "issue",
};

export function StickerStatusTag({ status }: { status: QrStickerStatus }) {
  const t = useTranslations("admin.qrStickers");
  const label =
    status === "linked"
      ? t("statusLinked")
      : status === "retired"
        ? t("statusRetired")
        : t("statusUnclaimed");
  return (
    <Tag variant={STATUS_VARIANT[status]} size="small">
      {label}
    </Tag>
  );
}

// Mirrors AdminGate's not-authorised state for screens reserved for super
// admins (AdminGate itself lets account admins through).
export function SuperAdminOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const t = useTranslations("admin.qrStickers");
  const tg = useTranslations("admin.gate");
  if (!isSuperAdmin(user)) {
    return (
      <div className="mx-auto max-w-md py-24 text-center">
        <h1 className="text-[20px] font-semibold text-[var(--color-foreground)]">
          {tg("unauthorizedTitle")}
        </h1>
        <p className="mt-2 text-[15px] text-[var(--color-muted-foreground)]">
          {t("superAdminOnly")}
        </p>
        <Link
          href="/admin"
          className="mt-6 inline-block text-[15px] font-medium text-[var(--color-brand)] hover:underline"
        >
          {t("backToAdmin")}
        </Link>
      </div>
    );
  }
  return <>{children}</>;
}

// Row selection for bulk actions. Retired stickers cannot be selected,
// since the only bulk action is retiring.
export type StickerSelection = {
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  disabled?: boolean;
};

// Sticker table with unlink / retire actions. Used by the batch detail
// screen and the "Find sticker by code" result.
export function StickerTable({
  stickers,
  onUpdated,
  showBatch = false,
  selection,
}: {
  stickers: QrSticker[];
  onUpdated: (sticker: QrSticker) => void;
  showBatch?: boolean;
  selection?: StickerSelection;
}) {
  const tb = useTranslations("admin.qrStickers.bulkPrint");
  const t = useTranslations("admin.qrStickers");
  const tErr = useTranslations("admin.apiErrors");
  const tc = useTranslations("common");
  const confirm = useConfirm();
  const shortDate = useShortDate();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function act(sticker: QrSticker, action: "unlink" | "retire") {
    const code = formatStickerCode(sticker.code);
    const ok = await confirm(
      action === "unlink"
        ? {
            title: t("unlinkConfirmTitle", { code }),
            description: t("unlinkConfirmBody", {
              machine: sticker.machineName ?? sticker.machineId ?? "",
            }),
            confirmLabel: t("unlinkConfirmLabel"),
            danger: true,
          }
        : {
            title: t("retireConfirmTitle", { code }),
            description: t("retireConfirmBody"),
            confirmLabel: t("retireConfirmLabel"),
            danger: true,
          },
    );
    if (!ok) return;
    setBusyId(sticker.id);
    setErr(null);
    try {
      const res = await updateQrSticker(sticker.id, action);
      onUpdated(res.sticker);
    } catch (e) {
      setErr(adminErrorMessage(e, tErr) ?? tc("unknownError"));
    } finally {
      setBusyId(null);
    }
  }

  const selectableIds = stickers
    .filter((s) => s.status !== "retired")
    .map((s) => s.id);
  const selectedInView = selection
    ? selectableIds.filter((id) => selection.selected.has(id)).length
    : 0;
  const allInViewSelected =
    selectableIds.length > 0 && selectedInView === selectableIds.length;

  function toggleOne(id: string) {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selection.onChange(next);
  }

  function toggleAllInView() {
    if (!selection) return;
    const next = new Set(selection.selected);
    for (const id of selectableIds) {
      if (allInViewSelected) next.delete(id);
      else next.add(id);
    }
    selection.onChange(next);
  }

  return (
    <div className="flex flex-col gap-2">
      {err && <p className="text-[13px] text-[var(--ds-red)]">{err}</p>}
      <div className="overflow-x-auto">
        <DataTable className="min-w-[640px]">
          <DataTableHead>
            {selection && (
              <DataTableHeader className="w-10">
                <Checkbox
                  checked={allInViewSelected}
                  indeterminate={!allInViewSelected && selectedInView > 0}
                  onChange={toggleAllInView}
                  aria-label={
                    allInViewSelected ? tb("deselectAll") : tb("selectAll")
                  }
                  disabled={selection.disabled || selectableIds.length === 0}
                />
              </DataTableHeader>
            )}
            <DataTableHeader>{t("colCode")}</DataTableHeader>
            <DataTableHeader>{t("colStatus")}</DataTableHeader>
            <DataTableHeader>{t("colMachine")}</DataTableHeader>
            <DataTableHeader>{t("colLinkedAt")}</DataTableHeader>
            {showBatch && <DataTableHeader>{t("colBatch")}</DataTableHeader>}
            <DataTableHeader align="right">
              <span className="sr-only">{t("colActions")}</span>
            </DataTableHeader>
          </DataTableHead>
          <DataTableBody>
            {stickers.map((s) => {
              const busy = busyId === s.id;
              return (
                <DataTableRow key={s.id}>
                  {selection && (
                    <DataTableCell className="w-10">
                      {s.status !== "retired" && (
                        <Checkbox
                          checked={selection.selected.has(s.id)}
                          onChange={() => toggleOne(s.id)}
                          aria-label={tb("selectMachine", {
                            name: formatStickerCode(s.code),
                          })}
                          disabled={selection.disabled}
                        />
                      )}
                    </DataTableCell>
                  )}
                  <DataTableCell className="font-mono tabular-nums">
                    {formatStickerCode(s.code)}
                  </DataTableCell>
                  <DataTableCell>
                    <StickerStatusTag status={s.status} />
                  </DataTableCell>
                  <DataTableCell>
                    {s.machineId ? (
                      <Link
                        href={`/admin/machines/${encodeURIComponent(s.machineId)}`}
                        className="text-[var(--color-brand)] hover:underline"
                      >
                        {s.machineName ?? s.machineId}
                      </Link>
                    ) : (
                      <span className="text-[var(--color-muted-foreground)]">
                        {t("noMachine")}
                      </span>
                    )}
                  </DataTableCell>
                  <DataTableCell>
                    {shortDate(s.linkedAt) ?? (
                      <span className="text-[var(--color-muted-foreground)]">
                        {t("notLinked")}
                      </span>
                    )}
                  </DataTableCell>
                  {showBatch && (
                    <DataTableCell>
                      <Link
                        href={`/admin/qr-stickers/${encodeURIComponent(s.batchId)}`}
                        className="text-[var(--color-brand)] hover:underline"
                      >
                        {t("openBatch")}
                      </Link>
                    </DataTableCell>
                  )}
                  <DataTableCell align="right">
                    <div className="flex justify-end gap-2">
                      {busy && <Spinner className="h-4 w-4 self-center" />}
                      {s.status === "linked" && (
                        <Button
                          variant="ghost"
                          size="pill"
                          onClick={() => void act(s, "unlink")}
                          disabled={busyId !== null}
                        >
                          <Unlink className="h-3.5 w-3.5" />
                          {t("unlink")}
                        </Button>
                      )}
                      {s.status !== "retired" && (
                        <Button
                          variant="ghostDanger"
                          size="pill"
                          onClick={() => void act(s, "retire")}
                          disabled={busyId !== null}
                        >
                          <Ban className="h-3.5 w-3.5" />
                          {t("retire")}
                        </Button>
                      )}
                    </div>
                  </DataTableCell>
                </DataTableRow>
              );
            })}
          </DataTableBody>
        </DataTable>
      </div>
    </div>
  );
}
