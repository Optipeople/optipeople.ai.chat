import { OptipeopleLogo } from "@/components/logo";
import { UserMenu } from "@/components/UserMenu";

export function AppHeader() {
  return (
    <header
      className="relative z-20 shrink-0"
      style={{ backgroundColor: "var(--color-brand)" }}
    >
      <div className="flex h-[35px] w-full items-center justify-between px-6">
        <OptipeopleLogo className="h-5 w-auto text-white" aria-label="Optipeople" />
        <UserMenu />
      </div>
    </header>
  );
}
