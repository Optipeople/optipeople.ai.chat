"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Check,
  ChevronDown,
  Globe,
  LogOut,
  Repeat,
  Settings,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { isAccountAdmin, isAdmin, isSuperAdmin, useAuth } from "@/auth/AuthContext";
import { locales, type Locale } from "@/i18n/config";
import { persistLocale } from "@/i18n/localeApi";
import { cn } from "@/lib/utils";

export function UserMenu() {
  const {
    user,
    logout,
    currentAccount,
    accounts,
    clearSelectedAccount,
    currentMachine,
    machines,
    clearSelectedMachine,
  } = useAuth();
  const t = useTranslations("userMenu");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<"language" | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      // Reset expanded section when the popover closes, so reopening
      // shows the default collapsed state. Synchronising local UI state
      // with the externally-controlled `open` flag.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setExpanded(null);
      return;
    }
    // Move focus into the menu so keyboard users aren't stranded on the
    // trigger with an open popover they can't reach.
    menuRef.current
      ?.querySelector<HTMLElement>('[role^="menuitem"]')
      ?.focus();
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
      const items = Array.from(
        menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ??
          [],
      );
      if (items.length === 0) return;
      e.preventDefault();
      const idx = items.indexOf(document.activeElement as HTMLElement);
      const next =
        e.key === "ArrowDown"
          ? items[(idx + 1) % items.length]
          : e.key === "ArrowUp"
            ? items[(idx - 1 + items.length) % items.length]
            : e.key === "Home"
              ? items[0]
              : items[items.length - 1];
      next.focus();
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

  async function handleSelectLocale(next: Locale) {
    setOpen(false);
    if (next === locale) return;
    await persistLocale(next, user?.email ?? null);
    router.refresh();
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={user.email}
        className={cn(
          "flex min-w-0 items-center gap-2 rounded-[2px] sm:gap-[10px]",
          "transition-colors hover:bg-white/5",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
        )}
      >
        <span className="hidden max-w-[40vw] truncate text-[14px] leading-[14px] text-[#eaeeee] sm:inline">
          {t("welcome", { name: displayName })}
        </span>
        <span className="max-w-[40vw] truncate text-[13px] leading-[13px] text-[#eaeeee] sm:hidden">
          {displayName}
        </span>
        <span
          aria-hidden
          className={cn(
            "flex h-[26px] shrink-0 items-center justify-center rounded-[2px] px-[7px] py-[3px]",
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
          ref={menuRef}
          role="menu"
          className={cn(
            "absolute right-0 top-[calc(100%+8px)] z-30 w-[min(calc(100vw-1.5rem),18rem)] overflow-hidden sm:w-64",
            "rounded-[6px] bg-[var(--color-surface)]",
            "border border-[var(--color-hairline)] shadow-[var(--shadow-lg)]",
          )}
        >
          <div className="px-4 py-3">
            <p className="text-[12px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
              {t("loggedInAs")}
            </p>
            <p className="mt-1 truncate text-[15px] font-medium text-[var(--color-foreground)]">
              {user.email}
            </p>
            <p className="mt-3 text-[12px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
              {t("role")}
            </p>
            <p className="mt-1 truncate text-[15px] font-medium text-[var(--color-foreground)]">
              {user.roleName ?? "—"}
            </p>
            {currentAccount && (
              <>
                <p className="mt-3 text-[12px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
                  {t("account")}
                </p>
                <p className="mt-1 truncate text-[15px] font-medium text-[var(--color-foreground)]">
                  {currentAccount.name}
                </p>
              </>
            )}
            {currentMachine && (
              <>
                <p className="mt-3 text-[12px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
                  {t("machine")}
                </p>
                <p className="mt-1 truncate text-[15px] font-medium text-[var(--color-foreground)]">
                  {currentMachine.name}
                </p>
              </>
            )}
          </div>
          <div className="h-px bg-[var(--color-hairline)]" />
          {isAdmin(user) && (
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
                {t("admin")}
              </Link>
              <Link
                href={
                  // Account admins skip the picker — they only have one
                  // account anyway. The /admin/accounts picker also
                  // auto-redirects them, so this is mostly belt-and-
                  // suspenders for the snappier transition.
                  isAccountAdmin(user) && user?.accountId
                    ? `/admin/accounts/${encodeURIComponent(user.accountId)}`
                    : "/admin/accounts"
                }
                role="menuitem"
                onClick={() => setOpen(false)}
                className={cn(
                  "flex w-full items-center gap-2 px-4 py-3 text-left text-[15px]",
                  "text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-muted)]",
                )}
              >
                <ShieldCheck className="h-4 w-4" />
                {t("accountSettings")}
              </Link>
              <div className="h-px bg-[var(--color-hairline)]" />
            </>
          )}
          {(accounts.length > 1 || isSuperAdmin(user)) && (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  clearSelectedAccount();
                  // The account/machine pickers are state-gated screens on
                  // "/", so get there in case we're on an admin page.
                  router.push("/");
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-4 py-3 text-left text-[15px]",
                  "text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-muted)]",
                )}
              >
                <Repeat className="h-4 w-4" />
                {t("switchAccount")}
              </button>
              <div className="h-px bg-[var(--color-hairline)]" />
            </>
          )}
          {machines.length > 1 && (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  clearSelectedMachine();
                  router.push("/");
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-4 py-3 text-left text-[15px]",
                  "text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-muted)]",
                )}
              >
                <Wrench className="h-4 w-4" />
                {t("switchMachine")}
              </button>
              <div className="h-px bg-[var(--color-hairline)]" />
            </>
          )}
          <SwitcherSection
            label={t("language")}
            icon={<Globe className="h-4 w-4" />}
            isOpen={expanded === "language"}
            onToggle={() =>
              setExpanded((prev) => (prev === "language" ? null : "language"))
            }
            items={locales.map((l) => ({
              id: l,
              name: t(`languages.${l}`),
              isCurrent: l === locale,
            }))}
            onSelect={(id) => {
              void handleSelectLocale(id as Locale);
            }}
          />
          <div className="h-px bg-[var(--color-hairline)]" />
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
            {t("logout")}
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
