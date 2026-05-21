import { redirect } from "next/navigation";

export default async function AdminMachineConversationsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/admin/machines/${encodeURIComponent(id)}?section=conversations`);
}
