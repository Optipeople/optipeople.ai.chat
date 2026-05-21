"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { getAccounts } from "@/auth/accountsApi";
import { isAccountAdmin, useAuth } from "@/auth/AuthContext";
import { Breadcrumbs, type Crumb } from "@/components/admin/Breadcrumbs";

// Breadcrumb for /admin/accounts/[accountId]. The page itself renders
// AI rules and MCP as collapsible sections, so there's no tab strip
// anymore — the breadcrumb is the only chrome above the content.
//
// For account admins, the "Accounts" picker crumb is omitted (they
// can't reach the picker — it auto-redirects them back).
export function AccountTabs({ accountId }: { accountId: string }) {
  const { user } = useAuth();
  const accountAdmin = isAccountAdmin(user);
  const tn = useTranslations("admin.nav.crumbs");
  const tSections = useTranslations("admin.nav.sections");
  const [accountName, setAccountName] = useState<string | null>(null);

  // Best-effort lookup. Account admins may 403 — fall back to the
  // account ID for the label in that case.
  useEffect(() => {
    let cancelled = false;
    getAccounts()
      .then((rows) => {
        if (cancelled) return;
        setAccountName(rows.find((a) => a.id === accountId)?.name ?? accountId);
      })
      .catch(() => {
        if (cancelled) return;
        setAccountName(accountId);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  const items: Crumb[] = [];
  if (!accountAdmin) {
    items.push({ label: tSections("accounts"), href: "/admin/accounts" });
  }
  items.push({
    label: accountName ?? tn("loading"),
    loading: accountName === null,
  });

  return <Breadcrumbs items={items} />;
}
