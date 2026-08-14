import { ConversationDetail } from "@/components/admin/ConversationDetail";

export const dynamic = "force-dynamic";

// Drilldown for a fleet ("all machines") conversation — reached from
// the account page's fleet-conversations section. Machine-scoped chats
// keep their /admin/machines/[id]/conversations/[convId] route.
export default async function AdminFleetConversationPage({
  params,
}: {
  params: Promise<{ accountId: string; convId: string }>;
}) {
  const { accountId, convId } = await params;
  return (
    <ConversationDetail
      source={{ kind: "fleet", accountId }}
      conversationId={convId}
    />
  );
}
