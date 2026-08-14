"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { Button } from "@/components/ui/button";

type ConfirmOptions = {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  // Render the confirm button in a destructive style. Use for delete /
  // remove / discard flows.
  danger?: boolean;
};

type Pending = {
  opts: ConfirmOptions;
  resolve: (value: boolean) => void;
};

const ConfirmContext = createContext<
  ((opts: ConfirmOptions) => Promise<boolean>) | null
>(null);

export function useConfirm(): (opts: ConfirmOptions) => Promise<boolean> {
  const ctx = useContext(ConfirmContext);
  if (!ctx)
    throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return ctx;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const t = useTranslations("common");
  const [pending, setPending] = useState<Pending | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, Boolean(pending));

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => setPending({ opts, resolve })),
    [],
  );

  const close = useCallback(
    (value: boolean) => {
      if (!pending) return;
      pending.resolve(value);
      setPending(null);
    },
    [pending],
  );

  useEffect(() => {
    if (!pending) return;

    function onKey(e: KeyboardEvent) {
      // Escape always cancels. Enter is deliberately NOT a global confirm
      // shortcut: focus starts on Cancel, and a reflexive Enter must never
      // trigger a destructive action. The focused button handles Enter.
      if (e.key === "Escape") {
        e.preventDefault();
        close(false);
      }
    }
    document.addEventListener("keydown", onKey);
    // Default focus on cancel — safer for destructive prompts.
    cancelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [pending, close]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:px-4"
        >
          <button
            type="button"
            aria-label={t("closeDialog")}
            onClick={() => close(false)}
            className="dialog-overlay absolute inset-0 bg-black/40 backdrop-blur-[2px]"
          />
          <div
            className={cn(
              "dialog-panel relative flex w-full max-w-[398px] flex-col items-start gap-4 rounded-[4px]",
              "border-[3px] border-solid border-[#fcfcfc] bg-[var(--ds-grey-light-02)]",
              "p-10 shadow-[0px_4px_4px_0px_rgba(0,0,0,0.1)] sm:p-16",
            )}
          >
            <h2
              id="confirm-dialog-title"
              className="break-words text-[16px] font-bold leading-[24px] text-[var(--ds-grey-dark-09)]"
            >
              {pending.opts.title}
            </h2>
            {pending.opts.description && (
              <div className="w-full break-words pb-3 text-[14px] leading-[21px] text-[var(--ds-grey-dark-09)]">
                {pending.opts.description}
              </div>
            )}
            <div className="flex w-full flex-wrap items-end justify-end gap-3">
              <Button
                ref={cancelRef}
                variant="secondary"
                onClick={() => close(false)}
              >
                {pending.opts.cancelLabel ?? t("cancel")}
              </Button>
              <Button
                variant={pending.opts.danger ? "destructive" : "primary"}
                onClick={() => close(true)}
              >
                {pending.opts.confirmLabel ??
                  (pending.opts.danger ? t("delete") : t("ok"))}
              </Button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
