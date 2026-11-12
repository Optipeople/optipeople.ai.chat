"use client";

import type { ComponentProps } from "react";
import { Markdown as UiMarkdown } from "@optipeople/ui/markdown";
import { fetchWithAuth } from "@/auth/authApi";
import { useFileViewer } from "@/components/FileViewer";

type Props = Omit<
  ComponentProps<typeof UiMarkdown>,
  "onOpenDoc" | "onOpenAsset" | "resolveAssetUrl"
>;

// Signed URL for an inline figure (`opti:asset/<id>`). A failed request
// throws, and the figure then collapses silently.
async function resolveAssetUrl(assetId: string): Promise<string | null> {
  const res = await fetchWithAuth(
    `/api/assets/${encodeURIComponent(assetId)}/url`,
  );
  if (!res.ok) throw new Error(`asset url ${res.status}`);
  const body = (await res.json()) as { url?: string };
  return body.url ?? null;
}

/**
 * The shared Markdown from @optipeople/ui, wired to this app: `opti:doc`
 * links and inline figures open in the FileViewer modal, and figure URLs
 * come from the assets API. Use this everywhere, never the package
 * Markdown directly.
 */
export function Markdown(props: Props) {
  const viewer = useFileViewer();
  return (
    <UiMarkdown
      {...props}
      onOpenDoc={({ id, page }) => viewer.open({ kind: "doc", id, page })}
      onOpenAsset={({ id, title }) =>
        viewer.open({ kind: "asset", id, title })
      }
      resolveAssetUrl={resolveAssetUrl}
    />
  );
}
