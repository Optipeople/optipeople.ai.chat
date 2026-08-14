"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { isAccountAdmin, useAuth } from "@/auth/AuthContext";

// Top-level navigation for the admin zone: Machines · Accounts.
// Lives inside AppHeader (admin only) and gives users a stable anchor
// for jumping between the two trees regardless of how deep they are.
//
// For account admins, "Accounts" deep-links into their own account hub
// so they skip the picker (which would just redirect them anyway).
export function SectionNav() {
  const pathname = usePathname() ?? "";
  const { user } = useAuth();
  const t = useTranslations("admin.nav.sections");

  const accountsHref =
    isAccountAdmin(user) && user?.accountId
      ? `/admin/accounts/${encodeURIComponent(user.accountId)}`
      : "/admin/accounts";

  const tabs: { id: string; label: string; href: string; match: string }[] = [
    {
      id: "machines",
      label: t("machines"),
      href: "/admin/machines",
      match: "/admin/machines",
    },
    {
      id: "accounts",
      label: t("accounts"),
      href: accountsHref,
      match: "/admin/accounts",
    },
    {
      id: "escalations",
      label: t("escalations"),
      href: "/admin/escalations",
      match: "/admin/escalations",
    },
  ];

  return (
    <div className="w-full border-b border-[var(--ds-grey-light-03)] bg-[var(--ds-grey-light-02)]">
      <div className="mx-auto w-full max-w-5xl overflow-x-auto overflow-y-clip px-3 sm:px-6">
        <nav
          aria-label="Admin sections"
          className="flex items-end gap-[7px] pt-3"
        >
          {tabs.map((tab) => {
            const active =
              pathname === tab.match || pathname.startsWith(`${tab.match}/`);
            return active ? (
              <Link
                key={tab.id}
                href={tab.href}
                aria-current="page"
                className="-mb-px flex flex-col items-stretch"
              >
                <span
                  aria-hidden
                  className="h-1 rounded-t-[1px] border-x border-t border-[var(--ds-grey-light-03)] bg-[var(--color-success)]"
                />
                <span className="border-x border-[var(--ds-grey-light-03)] bg-[var(--color-surface)] px-7 pt-[5px] pb-[3px] text-[14px] font-bold leading-4 text-[var(--ds-grey-dark-09)] shadow-[inset_1px_1px_2px_0_rgba(0,0,0,0.1)] whitespace-nowrap">
                  {tab.label}
                </span>
              </Link>
            ) : (
              <Link
                key={tab.id}
                href={tab.href}
                className="rounded-t-[1px] border border-[var(--ds-grey-light-03)] bg-white px-7 pt-[5px] pb-[3px] text-[14px] leading-[14px] text-[var(--ds-grey-dark-09)] opacity-60 shadow-[inset_1px_1px_2px_0_rgba(0,0,0,0.1)] transition-opacity hover:opacity-100 whitespace-nowrap"
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
