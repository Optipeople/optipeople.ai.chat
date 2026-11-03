"use client";

import { useTranslations } from "next-intl";
import { Tag, type TagSize } from "@/components/ui/tag";
import { isTrialExpired, trialDaysLeft } from "@/lib/trialDates";

// Trial badge for an account. Ended trials turn red ("issue") only when
// showExpired is set (super admins); everyone else keeps seeing the
// plain trial badge.
export function TrialTag({
  trialEndsAt,
  showExpired,
  size = "medium",
}: {
  trialEndsAt: string | null;
  showExpired: boolean;
  size?: TagSize;
}) {
  const t = useTranslations("admin.accountStatus");
  if (!trialEndsAt) return null;
  const expired = isTrialExpired(trialEndsAt);
  if (expired && showExpired) {
    return (
      <Tag variant="issue" size={size}>
        {t("badgeTrialEnded")}
      </Tag>
    );
  }
  const days = Math.max(0, trialDaysLeft(trialEndsAt));
  return (
    <Tag variant="warning" size={size}>
      {expired ? t("badgeTrial") : t("badgeTrialDays", { days })}
    </Tag>
  );
}
