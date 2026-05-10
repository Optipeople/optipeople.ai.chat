"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import { type ReactNode } from "react";
import { isSuperAdmin, useAuth } from "@/auth/AuthContext";

// Renders children only if the current user is a SuperAdministrator.
// Server-side admin routes still gate with requireSuperAdmin — this
// component is just UX so non-admins don't see a flicker of empty admin
// chrome before the API 403s.
export function AdminGate({ children }: { children: ReactNode }) {
  const { user, isInitializing } = useAuth();

  if (isInitializing) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--color-muted-foreground)]" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-md py-24 text-center">
        <h1 className="text-[20px] font-semibold text-[var(--color-foreground)]">
          Du er ikke logget ind
        </h1>
        <p className="mt-2 text-[15px] text-[var(--color-muted-foreground)]">
          Log ind for at få adgang til admin-området.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block text-[15px] font-medium text-[var(--color-brand)] hover:underline"
        >
          Til login
        </Link>
      </div>
    );
  }

  if (!isSuperAdmin(user)) {
    return (
      <div className="mx-auto max-w-md py-24 text-center">
        <h1 className="text-[20px] font-semibold text-[var(--color-foreground)]">
          Ikke autoriseret
        </h1>
        <p className="mt-2 text-[15px] text-[var(--color-muted-foreground)]">
          Admin-området er forbeholdt SuperAdministrator-rollen. Din rolle:{" "}
          {user.roleName ?? "ukendt"}.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block text-[15px] font-medium text-[var(--color-brand)] hover:underline"
        >
          Tilbage til chat
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
