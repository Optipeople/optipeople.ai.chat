import { redirect } from "next/navigation";

export default async function AdminMachineSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/admin/machines/${encodeURIComponent(id)}?section=settings`);
}
