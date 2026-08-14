"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Breadcrumbs, type Crumb } from "@/components/admin/Breadcrumbs";
import { getAdminMachine } from "@/admin/adminApi";

// Breadcrumb for /admin/machines/[id]. The page itself renders
// Knowledge / Settings / Conversations / Escalations as collapsible
// sections, so there's no tab strip anymore — the breadcrumb is the
// only chrome above the content.
export function MachineTabs({ machineId }: { machineId: string }) {
  const tn = useTranslations("admin.nav.crumbs");
  const tSections = useTranslations("admin.nav.sections");
  const [machineName, setMachineName] = useState<string | null>(null);

  // Lightweight fetch just for the breadcrumb label. The page itself
  // typically fetches the same machine again with its own state; that
  // duplication is intentional — keeps this component decoupled.
  useEffect(() => {
    let cancelled = false;
    getAdminMachine(machineId)
      .then((d) => {
        if (cancelled) return;
        setMachineName(d.displayName ?? machineId);
      })
      .catch(() => {
        if (cancelled) return;
        // Breadcrumb falls back to the machine ID instead of sitting on
        // the italic "loading" label forever.
        setMachineName(machineId);
      });
    return () => {
      cancelled = true;
    };
  }, [machineId]);

  const items: Crumb[] = [
    { label: tSections("machines"), href: "/admin/machines" },
    {
      label: machineName ?? tn("loading"),
      loading: machineName === null,
    },
  ];

  return <Breadcrumbs items={items} />;
}
