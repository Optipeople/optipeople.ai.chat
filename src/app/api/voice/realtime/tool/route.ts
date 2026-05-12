import { AuthError, resolveCurrentUser } from "@/lib/auth";
import { readQrTokenFromRequest, resolveQrToken } from "@/lib/qrAuth";
import { listDocuments, searchKb } from "@/lib/searchKb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ToolRequest = {
  name?: string;
  arguments?: Record<string, unknown>;
  machineId?: string;
  qrToken?: string | null;
};

export async function POST(req: Request) {
  let body: ToolRequest;
  try {
    body = (await req.json()) as ToolRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const hasBearer = !!req.headers.get("authorization");
  let resolvedMachineId = body.machineId ?? null;

  if (hasBearer) {
    try {
      await resolveCurrentUser(req);
    } catch (err) {
      if (err instanceof AuthError) return err.toResponse();
      throw err;
    }
  } else {
    const qrToken = readQrTokenFromRequest(req, body);
    if (!qrToken) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const session = await resolveQrToken(qrToken);
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    // QR sessions are pinned to the machine on the token — never trust
    // the body's machineId in this auth path.
    resolvedMachineId = session.machineId;
  }

  if (!resolvedMachineId) {
    return Response.json({ error: "machineId is required" }, { status: 400 });
  }

  if (body.name === "list_documents") {
    try {
      const docs = await listDocuments(resolvedMachineId);
      return Response.json({
        output: {
          documents: docs,
          count: docs.length,
        },
        chunkIds: [],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "list_documents failed";
      console.error("Realtime list_documents error:", err);
      return Response.json({ output: { error: message } }, { status: 200 });
    }
  }

  if (body.name !== "search_kb") {
    return Response.json({ error: `Unknown tool: ${body.name}` }, { status: 400 });
  }

  const args = body.arguments ?? {};
  const query = typeof args.query === "string" ? args.query : "";
  const topK = typeof args.top_k === "number" ? args.top_k : undefined;

  if (!query.trim()) {
    return Response.json({
      output: { error: "query must be a non-empty string" },
    });
  }

  try {
    const result = await searchKb({
      machineId: resolvedMachineId,
      query,
      topK,
    });
    return Response.json({
      output: {
        results: result.results.map((r) => ({
          document_id: r.document_id,
          title: r.title,
          page_from: r.page_from,
          page_to: r.page_to,
          text: r.text,
          is_image: r.is_image,
          image_alt: r.image_alt,
        })),
      },
      chunkIds: result.chunkIds,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "search_kb failed";
    console.error("Realtime tool error:", err);
    return Response.json({ output: { error: message } }, { status: 200 });
  }
}
