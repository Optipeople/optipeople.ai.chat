// Shared shape of a kb_insights row for the admin insight routes
// (machines/[id]/insights and insights/[id]). Kept out of the route files
// because Next.js only allows route exports there.

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
  promoted_doc_id: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

export const INSIGHT_SELECT_COLS =
  "id, conversation_id, machine_id, status, resolution, title, problem, cause, solution, facts, open_questions, promoted_doc_id, reviewed_by, reviewed_at, created_at, updated_at";

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
    promotedDocId: r.promoted_doc_id,
    reviewedBy: r.reviewed_by,
    reviewedAt: r.reviewed_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
