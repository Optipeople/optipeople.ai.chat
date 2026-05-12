"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  LogOut,
  Repeat,
  Settings,
  Wrench,
} from "lucide-react";
import { isSuperAdmin, useAuth } from "@/auth/AuthContext";
import { cn } from "@/lib/utils";

export function UserMenu() {
  const {
    user,
    logout,
    currentAccount,
    accounts,
    selectAccount,
    currentMachine,
    machines,
    selectMachine,
  } = useAuth();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<"account" | "machine" | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      // Reset expanded section when the popover closes, so reopening
      // shows the default collapsed state. Synchronising local UI state
      // with the externally-controlled `open` flag.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setExpanded(null);
      return;
    }
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

  const displayName =
    user.name ??
    (user.email.includes("@") ? user.email.split("@")[0] : user.email);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={user.email}
        className={cn(
          "flex items-center gap-[10px] rounded-[2px]",
          "transition-colors hover:bg-white/5",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
        )}
      >
        <span className="text-[14px] leading-[14px] text-[#eaeeee] whitespace-nowrap">
          Welcome, {displayName}
        </span>
        <span
          aria-hidden
          className={cn(
            "flex h-[26px] items-center justify-center rounded-[2px] px-[7px] py-[3px]",
            "shadow-[0_0.5px_1.25px_rgba(0,0,0,0.3),0_0_0_rgba(0,0,0,0.05)]",
          )}
        >
          <span
            className={cn(
              "flex h-4 w-[15px] items-center justify-center rounded-[2px]",
              "bg-[linear-gradient(180deg,rgba(255,255,255,0.17)_0%,rgba(255,255,255,0)_100%),linear-gradient(90deg,#eaeeee_0%,#eaeeee_100%)]",
              "shadow-[0_1px_2.5px_rgba(0,122,255,0.24),0_0_0_0.5px_rgba(0,122,255,0.12)]",
            )}
          >
            <ChevronDown className="h-2.5 w-2.5 text-[#134343]" strokeWidth={3} />
          </span>
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className={cn(
            "absolute right-0 top-[calc(100%+8px)] z-30 w-64 overflow-hidden",
            "rounded-[6px] bg-[var(--color-surface)]",
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
            <p className="mt-3 text-[12px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
              Rolle
            </p>
            <p className="mt-1 truncate text-[15px] font-medium text-[var(--color-foreground)]">
              {user.roleName ?? "—"}
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
            {currentMachine && (
              <>
                <p className="mt-3 text-[12px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
                  Maskine
                </p>
                <p className="mt-1 truncate text-[15px] font-medium text-[var(--color-foreground)]">
                  {currentMachine.name}
                </p>
              </>
            )}
          </div>
          <div className="h-px bg-[var(--color-hairline)]" />
          {isSuperAdmin(user) && (
            <>
              <Link
                href="/admin/machines"
                role="menuitem"
                onClick={() => setOpen(false)}
                className={cn(
                  "flex w-full items-center gap-2 px-4 py-3 text-left text-[15px]",
                  "text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-muted)]",
                )}
              >
                <Settings className="h-4 w-4" />
                Admin
              </Link>
              <div className="h-px bg-[var(--color-hairline)]" />
            </>
          )}
          {accounts.length > 1 && (
            <>
              <SwitcherSection
                label="Skift konto"
                icon={<Repeat className="h-4 w-4" />}
                isOpen={expanded === "account"}
                onToggle={() =>
                  setExpanded((prev) => (prev === "account" ? null : "account"))
                }
                items={accounts.map((a) => ({
                  id: a.id,
                  name: a.name,
                  isCurrent: a.id === currentAccount?.id,
                }))}
                onSelect={(id) => {
                  if (id === currentAccount?.id) return;
                  setOpen(false);
                  selectAccount(id);
                }}
              />
              <div className="h-px bg-[var(--color-hairline)]" />
            </>
          )}
          {machines.length > 1 && (
            <>
              <SwitcherSection
                label="Skift maskine"
                icon={<Wrench className="h-4 w-4" />}
                isOpen={expanded === "machine"}
                onToggle={() =>
                  setExpanded((prev) => (prev === "machine" ? null : "machine"))
                }
                items={machines.map((m) => ({
                  id: m.id,
                  name: m.name,
                  isCurrent: m.id === currentMachine?.id,
                }))}
                onSelect={(id) => {
                  if (id === currentMachine?.id) return;
                  setOpen(false);
                  selectMachine(id);
                }}
              />
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

type SwitcherItem = { id: string; name: string; isCurrent: boolean };

function SwitcherSection({
  label,
  icon,
  isOpen,
  onToggle,
  items,
  onSelect,
}: {
  label: string;
  icon: React.ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  items: SwitcherItem[];
  onSelect: (id: string) => void;
}) {
  return (
    <div>
      <button
        type="button"
        role="menuitem"
        aria-expanded={isOpen}
        onClick={onToggle}
        className={cn(
          "flex w-full items-center gap-2 px-4 py-3 text-left text-[15px]",
          "text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-muted)]",
        )}
      >
        {icon}
        <span className="flex-1">{label}</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-[var(--color-muted-foreground)] transition-transform",
            isOpen && "rotate-180",
          )}
        />
      </button>
      {isOpen && (
        <ul role="menu" className="max-h-56 overflow-y-auto bg-[var(--color-muted)]/40">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={item.isCurrent}
                onClick={() => onSelect(item.id)}
                className={cn(
                  "flex w-full items-center gap-2 px-4 py-2.5 pl-10 text-left text-[14px]",
                  "text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-muted)]",
                  item.isCurrent && "font-medium",
                )}
              >
                <span className="flex-1 truncate">{item.name}</span>
                {item.isCurrent && (
                  <Check className="h-4 w-4 text-[var(--color-brand)]" />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
