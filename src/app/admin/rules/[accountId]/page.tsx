import { AiRulesEditor } from "@/components/admin/AiRulesEditor";

export const dynamic = "force-dynamic";

export default async function AdminAiRulesEditorPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;
  return <AiRulesEditor accountId={accountId} />;
}
