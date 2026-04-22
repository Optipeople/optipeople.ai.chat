import { useEffect, useRef, useState } from "react";
import { LogOut, Repeat } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { cn } from "@/lib/utils";

export function UserMenu() {
  const { user, logout, currentAccount, accounts, clearSelectedAccount } =
    useAuth();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user) return null;

  const initial = user.email.trim().charAt(0).toUpperCase() || "?";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={user.email}
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-full text-[14px] font-semibold",
          "bg-white/15 text-white transition-colors hover:bg-white/25",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
        )}
      >
        {initial}
      </button>

      {open && (
        <div
          role="menu"
          className={cn(
            "absolute right-0 top-[calc(100%+8px)] z-30 w-64 overflow-hidden",
            "rounded-[var(--radius)] bg-[var(--color-surface)]",
            "border border-[var(--color-hairline)] shadow-[var(--shadow-lg)]",
          )}
        >
          <div className="px-4 py-3">
            <p className="text-[12px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
              Logget ind som
            </p>
            <p className="mt-1 truncate text-[15px] font-medium text-[var(--color-foreground)]">
              {user.email}
            </p>
            {currentAccount && (
              <>
                <p className="mt-3 text-[12px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
                  Konto
                </p>
                <p className="mt-1 truncate text-[15px] font-medium text-[var(--color-foreground)]">
                  {currentAccount.name}
                </p>
              </>
            )}
          </div>
          <div className="h-px bg-[var(--color-hairline)]" />
          {accounts.length > 1 && (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  clearSelectedAccount();
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-4 py-3 text-left text-[15px]",
                  "text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-muted)]",
                )}
              >
                <Repeat className="h-4 w-4" />
                Skift konto
              </button>
              <div className="h-px bg-[var(--color-hairline)]" />
            </>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              logout();
            }}
            className={cn(
              "flex w-full items-center gap-2 px-4 py-3 text-left text-[15px]",
              "text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-muted)]",
            )}
          >
            <LogOut className="h-4 w-4" />
            Log ud
          </button>
        </div>
      )}
    </div>
  );
}
