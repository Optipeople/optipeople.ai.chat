import { ConversationDetail } from "@/components/admin/ConversationDetail";

export const dynamic = "force-dynamic";

export default async function AdminConversationPage({
  params,
}: {
  params: Promise<{ id: string; convId: string }>;
}) {
  const { id, convId } = await params;
  return <ConversationDetail machineId={id} conversationId={convId} />;
}
