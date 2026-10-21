"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronRight, CircleHelp } from "lucide-react";
import { useTranslations } from "next-intl";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { TextField } from "@/components/ui/text-field";
import { Textarea } from "@/components/ui/textarea";
import { Tag, type TagVariant } from "@/components/ui/tag";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  adminErrorMessage,
  listAdminInsights,
  reviewAdminInsight,
  type AdminInsight,
  type AdminInsightAction,
  type AdminInsightStatus,
  type AdminInsightStatusFilter,
} from "@/admin/adminApi";

const DA_DT = new Intl.DateTimeFormat("da-DK", {
  dateStyle: "short",
  timeStyle: "short",
});

const PER_PAGE = 25;

const STATUS_VARIANT: Record<AdminInsightStatus, TagVariant> = {
  pending: "warning",
  published: "positive",
  rejected: "issue",
  nothing: "default",
};

type Draft = {
  title: string;
  problem: string;
  cause: string;
  solution: string;
  // One fact per line while editing.
  facts: string;
};

function toDraft(i: AdminInsight): Draft {
  return {
    title: i.title,
    problem: i.problem,
    cause: i.cause,
    solution: i.solution,
    facts: i.facts.join("\n"),
  };
}

function draftEdits(d: Draft) {
  return {
    title: d.title,
    problem: d.problem,
    cause: d.cause,
    solution: d.solution,
    facts: d.facts
      .split("\n")
      .map((f) => f.trim())
      .filter((f) => f.length > 0),
  };
}

function matchesFilter(status: AdminInsightStatus, filter: AdminInsightStatusFilter) {
  return filter === "all" ? status !== "nothing" : status === filter;
}

// Distilled learnings from this machine's conversations
// (src/lib/distill.ts). Pending ones wait for an admin to approve them
// into the KB, edit them, or reject them. `embedded` skips the
// page-level heading for use inside a section panel.
export function InsightsList({
  machineId,
  embedded = false,
}: {
  machineId: string;
  embedded?: boolean;
}) {
  const t = useTranslations("admin.insights");
  const tConv = useTranslations("admin.conversations");
  const tc = useTranslations("common");
  const tErr = useTranslations("admin.apiErrors");
  const confirm = useConfirm();
  const [items, setItems] = useState<AdminInsight[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [status, setStatus] = useState<AdminInsightStatusFilter>("pending");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listAdminInsights(machineId, { page, perPage: PER_PAGE, status })
      .then((res) => {
        if (cancelled) return;
        setItems(res.insights);
        setTotal(res.total);
        setError(null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(adminErrorMessage(err, tErr) ?? tc("unknownError"));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Translators are stable for the component's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machineId, page, status]);

  const STATUS_LABEL: Record<AdminInsightStatus, string> = {
    pending: t("statusPending"),
    published: t("statusPublished"),
    rejected: t("statusRejected"),
    nothing: t("statusNothing"),
  };

  function resolutionBadge(
    resolution: string | null,
  ): { label: string; variant: TagVariant } | null {
    switch (resolution) {
      case "resolved":
        return { label: tConv("resolutionResolved"), variant: "positive" };
      case "unresolved":
        return { label: tConv("resolutionUnresolved"), variant: "issue" };
      case "escalated":
        return { label: tConv("resolutionEscalated"), variant: "warning" };
      case "unknown":
        return { label: tConv("resolutionUnknown"), variant: "default" };
      default:
        return null;
    }
  }

  function startEdit(i: AdminInsight) {
    setEditingId(i.id);
    setDraft(toDraft(i));
    setActionError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(null);
  }

  async function act(i: AdminInsight, action: AdminInsightAction) {
    if (action === "reject" && i.promotedDocId) {
      const ok = await confirm({
        title: t("rejectPublishedConfirmTitle"),
        description: t("rejectPublishedConfirmBody"),
        confirmLabel: t("reject"),
        danger: true,
      });
      if (!ok) return;
    }
    const edits = editingId === i.id && draft && action !== "reject" ? draftEdits(draft) : {};
    setBusyId(i.id);
    setActionError(null);
    try {
      const updated = await reviewAdminInsight(i.id, action, edits);
      if (editingId === i.id) cancelEdit();
      if (matchesFilter(updated.status, status)) {
        setItems((prev) => prev.map((x) => (x.id === i.id ? updated : x)));
      } else {
        setItems((prev) => prev.filter((x) => x.id !== i.id));
        setTotal((n) => Math.max(0, n - 1));
      }
    } catch (err) {
      setActionError(adminErrorMessage(err, tErr) ?? tc("unknownError"));
    } finally {
      setBusyId(null);
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / PER_PAGE));

  function field(label: string, value: string) {
    if (!value) return null;
    return (
      <div>
        <dt className="text-[12px] font-medium text-[var(--color-muted-foreground)]">
          {label}
        </dt>
        <dd className="mt-0.5 whitespace-pre-wrap break-words text-[14px] text-[var(--color-foreground)]">
          {value}
        </dd>
      </div>
    );
  }

  function renderView(i: AdminInsight) {
    return (
      <dl className="flex flex-col gap-3">
        {field(t("problem"), i.problem)}
        {field(t("cause"), i.cause)}
        {field(t("solution"), i.solution)}
        {i.facts.length > 0 && (
          <div>
            <dt className="text-[12px] font-medium text-[var(--color-muted-foreground)]">
              {t("facts")}
            </dt>
            <dd className="mt-0.5">
              <ul className="list-disc pl-5 text-[14px] text-[var(--color-foreground)]">
                {i.facts.map((f, n) => (
                  <li key={n} className="break-words">
                    {f}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}
      </dl>
    );
  }

  function renderEdit(d: Draft) {
    const set = (key: keyof Draft) => (v: string) =>
      setDraft((prev) => (prev ? { ...prev, [key]: v } : prev));
    return (
      <div className="flex flex-col gap-3">
        <TextField
          label={t("titleLabel")}
          value={d.title}
          onChange={(e) => set("title")(e.target.value)}
        />
        <Textarea
          label={t("problem")}
          rows={3}
          autoGrow
          value={d.problem}
          onChange={(e) => set("problem")(e.target.value)}
        />
        <Textarea
          label={t("cause")}
          rows={3}
          autoGrow
          value={d.cause}
          onChange={(e) => set("cause")(e.target.value)}
        />
        <Textarea
          label={t("solution")}
          rows={3}
          autoGrow
          value={d.solution}
          onChange={(e) => set("solution")(e.target.value)}
        />
        <Textarea
          label={t("facts")}
          helpText={t("factsHelp")}
          rows={3}
          autoGrow
          value={d.facts}
          onChange={(e) => set("facts")(e.target.value)}
        />
      </div>
    );
  }

  function renderActions(i: AdminInsight) {
    const busy = busyId === i.id;
    if (editingId === i.id) {
      return (
        <>
          <Button size="sm" disabled={busy} onClick={() => void act(i, "approve")}>
            {i.status === "published" ? t("saveAndPublish") : t("approve")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => void act(i, "save")}
          >
            {t("save")}
          </Button>
          <Button variant="secondary" size="sm" disabled={busy} onClick={cancelEdit}>
            {tc("cancel")}
          </Button>
        </>
      );
    }
    return (
      <>
        {i.status !== "published" && (
          <Button size="sm" disabled={busy} onClick={() => void act(i, "approve")}>
            {t("approve")}
          </Button>
        )}
        <Button
          variant="secondary"
          size="sm"
          disabled={busy || editingId !== null}
          onClick={() => startEdit(i)}
        >
          {t("edit")}
        </Button>
        {i.status !== "rejected" && (
          <Button
            variant="destructive"
            size="sm"
            disabled={busy}
            onClick={() => void act(i, "reject")}
          >
            {t("reject")}
          </Button>
        )}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      {embedded ? (
        <p className="text-[13px] text-[var(--color-muted-foreground)] sm:text-[14px]">
          {t("description")}
        </p>
      ) : (
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-[var(--color-foreground)] sm:text-[24px]">
            {t("heading")}
          </h1>
          <p className="mt-1 text-[13px] text-[var(--color-muted-foreground)] sm:text-[14px]">
            {t("description")}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 sm:gap-4">
        <div className="min-w-[170px]">
          <Select
            label={t("filterStatus")}
            value={status}
            onValueChange={(v) => {
              setStatus(v as AdminInsightStatusFilter);
              setPage(0);
              setLoading(true);
              cancelEdit();
            }}
          >
            <option value="pending">{t("statusPending")}</option>
            <option value="published">{t("statusPublished")}</option>
            <option value="rejected">{t("statusRejected")}</option>
            <option value="nothing">{t("statusNothing")}</option>
            <option value="all">{t("filterAll")}</option>
          </Select>
        </div>
      </div>

      {actionError && (
        <div className="rounded-[4px] border border-[var(--ds-tag-red-dark)] bg-[var(--ds-tag-red-light)] p-3 text-[13px] text-[var(--ds-red-dark)]">
          {actionError}
        </div>
      )}

      {error ? (
        <div className="rounded-[4px] border border-[var(--ds-tag-red-dark)] bg-[var(--ds-tag-red-light)] p-6 text-[14px] text-[var(--ds-red-dark)]">
          {error}
        </div>
      ) : loading ? (
        <div className="flex h-32 items-center justify-center">
          <Spinner className="h-5 w-5" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-10 text-center text-[14px] text-[var(--color-muted-foreground)]">
          {status === "pending" ? t("emptyPending") : t("empty")}
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {items.map((i) => {
              const badge = resolutionBadge(i.resolution);
              const editing = editingId === i.id && draft !== null;
              return (
                <article
                  key={i.id}
                  className="flex flex-col gap-3 rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-3 sm:p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-[14px] font-medium text-[var(--color-foreground)]">
                        {i.title || t("untitled")}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <Tag variant={STATUS_VARIANT[i.status]} size="small">
                          {STATUS_LABEL[i.status]}
                        </Tag>
                        {badge && (
                          <Tag variant={badge.variant} size="small">
                            {badge.label}
                          </Tag>
                        )}
                      </div>
                    </div>
                    <span className="shrink-0 text-[12px] tabular-nums text-[var(--color-muted-foreground)]">
                      {DA_DT.format(new Date(i.createdAt))}
                    </span>
                  </div>

                  {editing ? renderEdit(draft) : renderView(i)}

                  {i.openQuestions.length > 0 && (
                    <div className="flex items-start gap-3 rounded-[4px] border border-amber-200 bg-amber-50 p-3 text-[14px] sm:p-4">
                      <CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-amber-900">{t("openQuestions")}</p>
                        <p className="mt-0.5 text-[12px] text-[var(--color-muted-foreground)]">
                          {t("openQuestionsHelp")}
                        </p>
                        <ul className="mt-1.5 list-disc pl-5 text-[13px] text-[var(--color-foreground)]">
                          {i.openQuestions.map((q, n) => (
                            <li key={n} className="break-words">
                              {q}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    {renderActions(i)}
                    <Link
                      href={`/admin/machines/${machineId}/conversations/${i.conversationId}`}
                      className="ml-auto inline-flex items-center gap-1 text-[13px] text-[var(--color-muted-foreground)] underline hover:text-[var(--color-foreground)]"
                    >
                      {t("openConversation")}
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                  </div>
                  {i.reviewedBy && i.reviewedAt && (
                    <p className="text-[12px] text-[var(--color-muted-foreground)]">
                      {t("reviewedBy", {
                        by: i.reviewedBy,
                        at: DA_DT.format(new Date(i.reviewedAt)),
                      })}
                    </p>
                  )}
                </article>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-[var(--color-muted-foreground)]">
            <span>{t("totalLabel", { count: total })}</span>
            {pageCount > 1 && (
              <Pagination
                page={page + 1}
                pageCount={pageCount}
                onChange={(p) => {
                  setPage(p - 1);
                  setLoading(true);
                }}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
