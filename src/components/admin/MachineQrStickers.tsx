"use client";

import { useCallback, useEffect, useState } from "react";
import { Link2, Unlink } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Spinner,
  Button,
  TextField,
  useConfirm,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@optipeople/ui";
import {
  QrStickerAlreadyLinkedError,
  adminErrorMessage,
  linkQrSticker,
  listMachineQrStickers,
  updateQrSticker,
} from "@/admin/adminApi";
import type { QrSticker } from "@/lib/qrStickerTypes";
import {
  formatStickerCode,
  useShortDate,
} from "@/components/admin/QrStickerShared";

// Pre-printed pool stickers linked to one machine, shown inside the
// machine QR card below the machine's own token.
export function MachineQrStickers({ machineId }: { machineId: string }) {
  const t = useTranslations("admin.qrStickers.machineCard");
  const tErr = useTranslations("admin.apiErrors");
  const tc = useTranslations("common");
  const confirm = useConfirm();
  const shortDate = useShortDate();
  const [stickers, setStickers] = useState<QrSticker[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [linking, setLinking] = useState(false);
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const res = await listMachineQrStickers(machineId);
    setStickers(res.stickers);
  }, [machineId]);

  useEffect(() => {
    let cancelled = false;
    listMachineQrStickers(machineId)
      .then((res) => {
        if (!cancelled) setStickers(res.stickers);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setLoadErr(adminErrorMessage(e, tErr) ?? tc("unknownError"));
        setStickers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [machineId, tErr, tc]);

  async function link() {
    const normalized = formatStickerCode(code);
    if (!normalized || linking) return;
    setLinking(true);
    setErr(null);
    try {
      try {
        await linkQrSticker({ code: normalized, machineId });
      } catch (e) {
        if (!(e instanceof QrStickerAlreadyLinkedError)) throw e;
        // Already linked to another machine: say so, then move it only
        // if the admin confirms.
        const reason =
          e instanceof QrStickerAlreadyLinkedError && e.machineName
            ? t("reassignCurrentMachine", { machine: e.machineName })
            : adminErrorMessage(e, tErr);
        const ok = await confirm({
          title: t("reassignTitle", { code: normalized }),
          description: (
            <>
              {reason && <p>{reason}</p>}
              <p className={reason ? "mt-2" : undefined}>
                {t("reassignBody")}
              </p>
            </>
          ),
          confirmLabel: t("reassignConfirm"),
          danger: true,
        });
        if (!ok) return;
        await linkQrSticker({ code: normalized, machineId, reassign: true });
      }
      setCode("");
      await reload();
    } catch (e) {
      setErr(adminErrorMessage(e, tErr) ?? tc("unknownError"));
    } finally {
      setLinking(false);
    }
  }

  async function unlink(sticker: QrSticker) {
    const formatted = formatStickerCode(sticker.code);
    const ok = await confirm({
      title: t("unlinkConfirmTitle", { code: formatted }),
      description: t("unlinkConfirmBody"),
      confirmLabel: t("unlinkConfirmLabel"),
      danger: true,
    });
    if (!ok) return;
    setUnlinkingId(sticker.id);
    setErr(null);
    try {
      await updateQrSticker(sticker.id, "unlink");
      await reload();
    } catch (e) {
      setErr(adminErrorMessage(e, tErr) ?? tc("unknownError"));
    } finally {
      setUnlinkingId(null);
    }
  }

  return (
    <div className="mt-5 border-t border-[var(--color-hairline)] pt-4">
      <h3 className="text-[15px] font-semibold text-[var(--color-foreground)]">
        {t("heading")}
      </h3>
      <p className="mt-1 text-[13px] text-[var(--color-muted-foreground)]">
        {t("description")}
      </p>

      <div className="mt-3">
        {stickers === null ? (
          <div className="flex h-12 items-center justify-center">
            <Spinner className="h-4 w-4" />
          </div>
        ) : loadErr ? (
          <p className="text-[13px] text-[var(--ds-red)]">{loadErr}</p>
        ) : stickers.length === 0 ? (
          <p className="text-[13px] text-[var(--color-muted-foreground)]">
            {t("empty")}
          </p>
        ) : (
          <DataTable>
            <DataTableHead>
              <DataTableHeader>{t("colCode")}</DataTableHeader>
              <DataTableHeader>{t("colLinkedAt")}</DataTableHeader>
              <DataTableHeader align="right">
                <span className="sr-only">{t("colActions")}</span>
              </DataTableHeader>
            </DataTableHead>
            <DataTableBody>
              {stickers.map((s) => (
                <DataTableRow key={s.id}>
                  <DataTableCell className="font-mono tabular-nums">
                    {formatStickerCode(s.code)}
                  </DataTableCell>
                  <DataTableCell>{shortDate(s.linkedAt) ?? ""}</DataTableCell>
                  <DataTableCell align="right">
                    <Button
                      variant="ghost"
                      size="pill"
                      onClick={() => void unlink(s)}
                      disabled={unlinkingId !== null || linking}
                    >
                      {unlinkingId === s.id ? (
                        <Spinner className="h-3.5 w-3.5" />
                      ) : (
                        <Unlink className="h-3.5 w-3.5" />
                      )}
                      {t("unlink")}
                    </Button>
                  </DataTableCell>
                </DataTableRow>
              ))}
            </DataTableBody>
          </DataTable>
        )}
      </div>

      <form
        className="mt-4 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void link();
        }}
      >
        <div className="w-full sm:w-64">
          <TextField
            label={t("linkLabel")}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={t("codePlaceholder")}
            autoComplete="off"
            spellCheck={false}
            disabled={linking}
          />
        </div>
        <Button
          type="submit"
          variant="secondary"
          size="sm"
          disabled={linking || !code.trim()}
        >
          {linking ? (
            <Spinner className="mr-1.5 h-4 w-4" />
          ) : (
            <Link2 className="mr-1.5 h-4 w-4" />
          )}
          {t("linkSubmit")}
        </Button>
      </form>

      {err && <p className="mt-2 text-[13px] text-[var(--ds-red)]">{err}</p>}
    </div>
  );
}
