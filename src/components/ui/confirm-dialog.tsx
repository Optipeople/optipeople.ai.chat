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
import { cn } from "@/lib/utils";

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
  const [pending, setPending] = useState<Pending | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

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
      if (e.key === "Escape") {
        e.preventDefault();
        close(false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        close(true);
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
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
        >
          <button
            type="button"
            aria-label="Luk dialog"
            onClick={() => close(false)}
            className="dialog-overlay absolute inset-0 bg-black/40 backdrop-blur-[2px]"
          />
          <div
            className={cn(
              "dialog-panel relative w-full max-w-md rounded-[var(--radius-lg)]",
              "bg-[var(--color-surface)] shadow-[var(--shadow-lg)]",
              "border border-[var(--color-hairline)] p-6",
            )}
          >
            <h2
              id="confirm-dialog-title"
              className="text-[18px] font-semibold tracking-tight text-[var(--color-foreground)]"
            >
              {pending.opts.title}
            </h2>
            {pending.opts.description && (
              <div className="mt-2 text-[14px] leading-relaxed text-[var(--color-muted-foreground)]">
                {pending.opts.description}
              </div>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <button
                ref={cancelRef}
                type="button"
                onClick={() => close(false)}
                className={cn(
                  "h-10 rounded-[var(--radius)] px-4 text-[14px] font-medium",
                  "text-[var(--color-foreground)] hover:bg-[var(--color-muted)]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
                )}
              >
                {pending.opts.cancelLabel ?? "Annullér"}
              </button>
              <button
                type="button"
                onClick={() => close(true)}
                className={cn(
                  "h-10 rounded-[var(--radius)] px-4 text-[14px] font-medium text-white",
                  "transition-colors focus-visible:outline-none focus-visible:ring-2",
                  pending.opts.danger
                    ? "bg-red-600 hover:bg-red-700 focus-visible:ring-red-300"
                    : "bg-[var(--color-brand)] hover:opacity-90 focus-visible:ring-[var(--color-ring)]",
                )}
              >
                {pending.opts.confirmLabel ??
                  (pending.opts.danger ? "Slet" : "OK")}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
