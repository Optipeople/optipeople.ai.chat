import Link from "next/link";
import { OptipeopleLogo } from "@/components/logo";
import { UserMenu } from "@/components/UserMenu";

export function AppHeader() {
  return (
    <header
      className="relative z-20 shrink-0"
      style={{ backgroundColor: "var(--color-brand)" }}
    >
      <div className="flex h-[42px] w-full items-center justify-between gap-3 px-4 sm:h-[35px] sm:px-6">
        <Link
          href="/"
          aria-label="Optipeople"
          className="shrink-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <OptipeopleLogo className="h-5 w-auto text-white" />
        </Link>
        <UserMenu />
      </div>
    </header>
  );
}
