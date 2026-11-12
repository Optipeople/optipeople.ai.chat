"use client";

import { AppHeader as UiAppHeader } from "@optipeople/ui/blocks";
import { useAuth } from "@/auth/AuthContext";
import { LocaleToggle } from "@/components/LocaleToggle";
import { UserMenu } from "@/components/UserMenu";

export function AppHeader() {
  const { user } = useAuth();
  return (
    <UiAppHeader>
      {/* Anonymous QR operators have no UserMenu, so they get the
          language toggle directly. A Danish operator is then not locked
          into English on a fresh phone. */}
      {user ? <UserMenu /> : <LocaleToggle />}
    </UiAppHeader>
  );
}
