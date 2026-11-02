import { QrStickerBatchDetail } from "@/components/admin/QrStickerBatchDetail";

export const dynamic = "force-dynamic";

export default async function AdminQrStickerBatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <QrStickerBatchDetail batchId={id} />;
}
