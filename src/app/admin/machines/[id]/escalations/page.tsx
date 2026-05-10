import { EscalationsList } from "@/components/admin/EscalationsList";

export const dynamic = "force-dynamic";

export default async function AdminMachineEscalationsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <EscalationsList machineId={id} />;
}
