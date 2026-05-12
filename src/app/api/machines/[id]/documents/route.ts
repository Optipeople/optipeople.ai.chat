// GET /api/machines/[id]/documents
//
// Lists documents the admin has explicitly marked operator_visible for
// this machine. Powers the chat-side knowledge drawer so operators can
// browse manuals manually instead of only through the AI. Accepts the
// same auth shapes as the chat itself: Optipeople bearer OR machine QR
// token (header / query param). QR sessions are pinned to one machine —
// reject any cross-machine probe.

import { AuthError, resolveCurrentUser } from "@/lib/auth";
import { readQrTokenFromRequest, resolveQrToken } from "@/lib/qrAuth";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type OperatorDocument = {
  id: string;
  title: string;
  summary: string;
  folderPath: string | null;
  sourceType: "pdf" | "url" | "manual_note" | "feedback" | "image";
  pageCount: number | null;
};

export type OperatorDocumentsResponse = {
  documents: OperatorDocument[];
};

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!id) {
    return Response.json({ error: "machine id is required" }, { status: 400 });
  }

  const hasBearer = !!req.headers.get("authorization");
  const url = new URL(req.url);
  const qrToken =
    readQrTokenFromRequest(req, null) ?? url.searchParams.get("qrToken");

  if (hasBearer) {
    try {
      await resolveCurrentUser(req);
    } catch (err) {
      if (err instanceof AuthError) return err.toResponse();
      throw err;
    }
  } else if (qrToken) {
    const session = await resolveQrToken(qrToken);
    if (!session) {
      return Response.json(
        { error: "Invalid or revoked QR token" },
        { status: 401 },
      );
    }
    if (session.machineId !== id) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
  } else {
    return Response.json(
      { error: "Missing or malformed Authorization header" },
      { status: 401 },
    );
  }

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("kb_documents")
    .select("id, title, summary, folder_path, source_type, page_count, status")
    .eq("machine_id", id)
    .eq("operator_visible", true)
    .eq("status", "ready")
    .order("folder_path", { ascending: true, nullsFirst: true })
    .order("title", { ascending: true });

  if (error) {
    console.error("operator docs list failed:", error);
    return Response.json({ error: "Database error" }, { status: 500 });
  }

  const documents: OperatorDocument[] = (data ?? []).map((d) => {
    const r = d as {
      id: string;
      title: string;
      summary: string;
      folder_path: string | null;
      source_type: OperatorDocument["sourceType"];
      page_count: number | null;
    };
    return {
      id: r.id,
      title: r.title,
      summary: r.summary,
      folderPath: r.folder_path ?? null,
      sourceType: r.source_type,
      pageCount: r.page_count,
    };
  });

  const body: OperatorDocumentsResponse = { documents };
  return Response.json(body);
}
