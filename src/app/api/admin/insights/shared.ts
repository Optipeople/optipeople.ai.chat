// Shared shape of a kb_insights row for the admin insight routes
// (machines/[id]/insights and insights/[id]). Kept out of the route files
// because Next.js only allows route exports there.

import { getAttachmentsByIds, signAttachments } from "@/lib/chatAttachments";

// Signed URLs for admin thumbnails. An hour covers a review session.
const PHOTO_URL_TTL = 60 * 60;

// One operator photo a learning was distilled from.
export type AdminInsightPhoto = {
  id: string;
  url: string;
  caption: string | null;
  altText: string | null;
};

export type AdminInsightStatus = "pending" | "published" | "rejected" | "nothing";

export type AdminInsight = {
  id: string;
  conversationId: string;
  machineId: string;
  status: AdminInsightStatus;
  resolution: string | null;
  title: string;
  problem: string;
  cause: string;
  solution: string;
  facts: string[];
  openQuestions: string[];
  attachmentIds: string[];
  // Filled by withInsightPhotos; photos that fail to sign are left out.
  photos: AdminInsightPhoto[];
  promotedDocId: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminInsightRow = {
  id: string;
  conversation_id: string;
  machine_id: string;
  status: AdminInsightStatus;
  resolution: string | null;
  title: string;
  problem: string;
  cause: string;
  solution: string;
  facts: string[] | null;
  open_questions: string[] | null;
  attachment_ids: string[] | null;
  promoted_doc_id: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

export const INSIGHT_SELECT_COLS =
  "id, conversation_id, machine_id, status, resolution, title, problem, cause, solution, facts, open_questions, attachment_ids, promoted_doc_id, reviewed_by, reviewed_at, created_at, updated_at";

export function toAdminInsight(r: AdminInsightRow): AdminInsight {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    machineId: r.machine_id,
    status: r.status,
    resolution: r.resolution,
    title: r.title,
    problem: r.problem,
    cause: r.cause,
    solution: r.solution,
    facts: r.facts ?? [],
    openQuestions: r.open_questions ?? [],
    attachmentIds: r.attachment_ids ?? [],
    photos: [],
    promotedDocId: r.promoted_doc_id,
    reviewedBy: r.reviewed_by,
    reviewedAt: r.reviewed_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// Adds signed photo URLs to a page of insights, in one lookup and one
// signing call. Best effort: a failure leaves the photos empty rather
// than failing the list.
export async function withInsightPhotos(
  insights: AdminInsight[],
): Promise<AdminInsight[]> {
  const ids = [...new Set(insights.flatMap((i) => i.attachmentIds))];
  if (ids.length === 0) return insights;
  try {
    const attachments = await getAttachmentsByIds(ids);
    const urls = await signAttachments(attachments, PHOTO_URL_TTL);
    const byId = new Map(attachments.map((a) => [a.id, a]));
    return insights.map((i) => ({
      ...i,
      photos: i.attachmentIds.flatMap((id) => {
        const a = byId.get(id);
        const url = urls.get(id);
        return a && url
          ? [{ id, url, caption: a.caption, altText: a.altText }]
          : [];
      }),
    }));
  } catch (err) {
    console.error("admin insight photos failed:", err);
    return insights;
  }
}
