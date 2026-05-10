import Link from "next/link";
import type { ReactNode } from "react";
import { OptipeopleLogo } from "@/components/logo";
import { UserMenu } from "@/components/UserMenu";
import { AdminGate } from "@/components/admin/AdminGate";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col bg-[var(--color-background)]">
      <header
        className="relative z-20 shrink-0"
        style={{ backgroundColor: "var(--color-brand)" }}
      >
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <Link href="/admin/machines" className="flex items-center gap-3">
            <OptipeopleLogo className="h-7 w-auto text-white" aria-label="Optipeople" />
            <span className="text-[15px] font-medium text-white/90">
              Admin — OptiAI
            </span>
          </Link>
          <UserMenu />
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        <AdminGate>{children}</AdminGate>
      </main>
    </div>
  );
}
