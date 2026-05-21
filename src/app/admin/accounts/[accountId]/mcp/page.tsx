import { redirect } from "next/navigation";

export default async function AdminAccountMcpPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;
  redirect(`/admin/accounts/${encodeURIComponent(accountId)}?section=mcp`);
}
