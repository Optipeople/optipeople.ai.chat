import { MachineDetail } from "@/components/admin/MachineDetail";

export const dynamic = "force-dynamic";

export default async function AdminMachinePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <MachineDetail machineId={id} />;
}
