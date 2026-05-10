import { QrPrintView } from "@/components/admin/QrPrintView";

export const dynamic = "force-dynamic";

export default async function AdminMachineQrPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <QrPrintView machineId={id} />;
}
