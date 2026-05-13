import { OptipeopleLogo } from "@/components/logo";
import { UserMenu } from "@/components/UserMenu";

export function AppHeader() {
  return (
    <header
      className="relative z-20 shrink-0"
      style={{ backgroundColor: "var(--color-brand)" }}
    >
      <div className="flex h-[42px] w-full items-center justify-between gap-3 px-4 sm:h-[35px] sm:px-6">
        <OptipeopleLogo
          className="h-5 w-auto shrink-0 text-white"
          aria-label="Optipeople"
        />
        <UserMenu />
      </div>
    </header>
  );
}
