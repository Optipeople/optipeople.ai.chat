import type { ReactNode } from "react";
import { AppHeader } from "@/components/AppHeader";
import { AdminGate } from "@/components/admin/AdminGate";
import { SectionNav } from "@/components/admin/SectionNav";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col overflow-x-hidden bg-[var(--color-background)]">
      <AppHeader />
      <SectionNav />

      <main className="mx-auto w-full max-w-5xl flex-1 px-3 py-5 sm:px-6 sm:py-10">
        <AdminGate>{children}</AdminGate>
      </main>

      <div className="brand-stripe" aria-hidden>
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
