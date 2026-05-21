import { AccountSections } from "@/components/admin/AccountSections";

export const dynamic = "force-dynamic";

export default async function AdminAccountIndexPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;
  return <AccountSections accountId={accountId} />;
}
