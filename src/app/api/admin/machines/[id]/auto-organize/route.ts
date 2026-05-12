// POST /api/admin/machines/[id]/auto-organize
//
// Two modes (discriminated by the request body):
//   { mode: "preview" }                  → propose moves, don't apply
//   { mode: "apply", moves: [...] }      → apply the confirmed subset
//
// Preview calls Claude Haiku; apply is a pure database mutation. The
// admin UI calls preview first, shows a checkbox list, then calls apply
// with whatever the operator left checked.

import { AuthError, requireSuperAdmin } from "@/lib/auth";
import {
  applyAutoOrganize,
  proposeAutoOrganize,
  type AutoOrganizeMove,
  type AutoOrganizeProposal,
  type StandardFolder,
} from "@/lib/autoOrganize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Classify can take ~10–20s for a couple dozen docs through Haiku. The
// platform default of 300s is fine; we set it explicitly so a future env
// override can't clip it.
export const maxDuration = 300;

export type AutoOrganizePreviewResponse = {
  proposals: AutoOrganizeProposal[];
  folders: StandardFolder[];
};

export type AutoOrganizeApplyResponse = {
  applied: number;
};

async function gate(req: Request): Promise<Response | null> {
  try {
    await requireSuperAdmin(req);
    return null;
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const denied = await gate(req);
  if (denied) return denied;

  const { id: machineId } = await ctx.params;

  let body: { mode?: unknown; moves?: unknown };
  try {
    body = (await req.json()) as { mode?: unknown; moves?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const mode = body.mode === "apply" ? "apply" : "preview";

  if (mode === "preview") {
    try {
      const result = await proposeAutoOrganize(machineId);
      const response: AutoOrganizePreviewResponse = {
        proposals: result.proposals,
        folders: result.folders,
      };
      return Response.json(response);
    } catch (err) {
      console.error("auto-organize preview failed:", err);
      const message = err instanceof Error ? err.message : "Unknown error";
      return Response.json(
        { error: `Auto-organisering fejlede: ${message}` },
        { status: 500 },
      );
    }
  }

  const rawMoves = Array.isArray(body.moves) ? body.moves : [];
  const moves: AutoOrganizeMove[] = [];
  for (const m of rawMoves) {
    if (!m || typeof m !== "object") continue;
    const id = (m as { id?: unknown }).id;
    const folder = (m as { folder?: unknown }).folder;
    if (typeof id === "string" && typeof folder === "string") {
      moves.push({ id, folder });
    }
  }

  if (moves.length === 0) {
    return Response.json({ applied: 0 } satisfies AutoOrganizeApplyResponse);
  }

  try {
    const result = await applyAutoOrganize(machineId, moves);
    return Response.json(result satisfies AutoOrganizeApplyResponse);
  } catch (err) {
    console.error("auto-organize apply failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json(
      { error: `Anvendelse fejlede: ${message}` },
      { status: 500 },
    );
  }
}

