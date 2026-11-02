// Scan landing page for pre-printed QR stickers at /q/<token>.
//
// Linked stickers bounce straight into the existing /?qr=<token> chat
// flow. Unclaimed stickers let an admin link them to a machine on the
// spot. See docs/qr-sticker-pool-plan.md.

import { QrStickerScan } from "@/components/QrStickerScan";

export const dynamic = "force-dynamic";

export default async function QrStickerScanPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <QrStickerScan token={token} />;
}
