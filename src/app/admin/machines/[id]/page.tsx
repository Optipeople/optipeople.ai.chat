import { MachineSections } from "@/components/admin/MachineSections";
import { MachineTabs } from "@/components/admin/MachineTabs";

export const dynamic = "force-dynamic";

export default async function AdminMachinePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      <MachineTabs machineId={id} />
      <MachineSections machineId={id} />
    </div>
  );
}
