import type { ReactNode } from "react";
import { AccountTabs } from "@/components/admin/AccountTabs";

export const dynamic = "force-dynamic";

export default async function AdminAccountLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;
  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      <AccountTabs accountId={accountId} />
      <div>{children}</div>
    </div>
  );
}
