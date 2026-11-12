"use client";

import { useTranslations } from "next-intl";
import {
  SectionNav as UiSectionNav,
  type SectionNavItem,
} from "@optipeople/ui/blocks";
import { isAccountAdmin, isSuperAdmin, useAuth } from "@/auth/AuthContext";

// Top-level navigation for the admin zone: Machines, Accounts,
// Escalations, plus QR stickers for super admins.
// Sits right under AppHeader (admin only) and gives users a stable anchor
// for jumping between the trees regardless of how deep they are.
//
// For account admins, "Accounts" deep-links into their own account hub
// so they skip the picker (which would just redirect them anyway).
export function SectionNav() {
  const { user } = useAuth();
  const t = useTranslations("admin.nav.sections");

  const accountsHref =
    isAccountAdmin(user) && user?.accountId
      ? `/admin/accounts/${encodeURIComponent(user.accountId)}`
      : "/admin/accounts";

  const items: SectionNavItem[] = [
    { label: t("machines"), href: "/admin/machines" },
    { label: t("accounts"), href: accountsHref, match: "/admin/accounts" },
    { label: t("escalations"), href: "/admin/escalations" },
    // Sticker batches span every account, so only super admins see them.
    ...(isSuperAdmin(user)
      ? [{ label: t("qrStickers"), href: "/admin/qr-stickers" }]
      : []),
  ];

  return <UiSectionNav items={items} label="Admin sections" />;
}
