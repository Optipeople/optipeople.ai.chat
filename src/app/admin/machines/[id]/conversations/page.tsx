import { ConversationsList } from "@/components/admin/ConversationsList";

export const dynamic = "force-dynamic";

export default async function AdminMachineConversationsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ConversationsList machineId={id} />;
}
