// Read-only transcript view at /escalation/<token>.
//
// Public, token-gated. Service tech opens this from the link the
// operator generated when hitting "Tilkald service". No login. The
// transcript comes from the snapshot stored on the escalations row, not
// the live conversations/messages tables — this is a frozen handoff.

import { notFound } from "next/navigation";
import { Wrench } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { Markdown } from "@/components/ui/markdown";
import { OptipeopleLogo } from "@/components/logo";
import type {
  EscalationChannel,
  EscalationSnapshot,
} from "@/lib/escalation";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function localeTag(locale: string): string {
  return locale === "da" ? "da-DK" : "en-US";
}

type EscalationRow = {
  id: string;
  channel: EscalationChannel;
  target: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
  expires_at: string | null;
  context_blob: EscalationSnapshot | null;
};

async function loadEscalation(token: string): Promise<EscalationRow | "expired" | null> {
  if (!token || token.length < 16) return null;
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("escalations")
    .select(
      "id, channel, target, note, created_by, created_at, expires_at, context_blob",
    )
    .eq("share_token", token)
    .maybeSingle();
  if (error) {
    console.error("escalation page lookup failed:", error);
    return null;
  }
  if (!data) return null;
  const row = data as EscalationRow;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    return "expired";
  }
  return row;
}

export default async function EscalationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const result = await loadEscalation(token);

  if (result === null) notFound();
  if (result === "expired") {
    return <ExpiredView />;
  }
  if (!result.context_blob) notFound();

  const snapshot = result.context_blob;
  const t = await getTranslations("escalationPage");
  const locale = await getLocale();
  const tag = localeTag(locale);
  const dt = new Intl.DateTimeFormat(tag, {
    dateStyle: "long",
    timeStyle: "short",
  });
  const time = new Intl.DateTimeFormat(tag, { timeStyle: "short" });
  const channelLabel = t(`channels.${result.channel}`);

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-background)]">
      <header
        className="sticky top-0 z-10 border-b border-[var(--color-hairline)]"
        style={{ backgroundColor: "var(--color-brand)" }}
      >
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:gap-4 sm:px-6">
          <OptipeopleLogo
            className="h-6 w-auto shrink-0 text-white sm:h-7"
            aria-label={t("logoLabel")}
          />
          <div className="flex shrink-0 items-center gap-2 text-[13px] font-medium text-white/90">
            <Wrench className="h-4 w-4" />
            <span className="hidden sm:inline">{t("serviceRequest")}</span>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-5 sm:px-6 sm:py-8">
        <section className="rounded-[var(--radius)] border border-amber-200 bg-amber-50 p-4 sm:p-5">
          <h1 className="break-words text-[18px] font-semibold tracking-tight text-amber-900 sm:text-[20px]">
            {snapshot.machineName ?? t("unknownMachine")}
          </h1>
          <p className="mt-1 break-words text-[13px] text-amber-900/80">
            {t.rich("calledAt", {
              date: dt.format(new Date(result.created_at)),
              channel: channelLabel,
              target: () => (
                <span className="font-mono break-all">{result.target}</span>
              ),
            })}
          </p>
          {result.note && (
            <div className="mt-4 rounded-[var(--radius)] border border-amber-200 bg-white p-3 text-[14px]">
              <p className="text-[12px] font-medium uppercase tracking-wide text-amber-800">
                {t("operatorDescription")}
              </p>
              <p className="mt-1 whitespace-pre-wrap break-words text-[var(--color-foreground)]">
                {result.note}
              </p>
            </div>
          )}
        </section>

        <section className="mt-5 rounded-[var(--radius)] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-4 sm:mt-6 sm:p-5">
          <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-[13px] sm:grid-cols-3">
            <div className="flex flex-wrap gap-x-2 gap-y-0.5">
              <dt className="text-[var(--color-muted-foreground)]">{t("operator")}</dt>
              <dd className="min-w-0 break-words text-[var(--color-foreground)]">
                {snapshot.operator.name ?? snapshot.operator.email ?? "—"}
                {snapshot.operator.name && snapshot.operator.email && (
                  <span className="ml-1 text-[var(--color-muted-foreground)]">
                    ({snapshot.operator.email})
                  </span>
                )}
              </dd>
            </div>
            <div className="flex flex-wrap gap-x-2 gap-y-0.5">
              <dt className="text-[var(--color-muted-foreground)]">
                {t("conversationStarted")}
              </dt>
              <dd className="text-[var(--color-foreground)]">
                {dt.format(new Date(snapshot.startedAt))}
              </dd>
            </div>
            <div className="flex flex-wrap gap-x-2 gap-y-0.5">
              <dt className="text-[var(--color-muted-foreground)]">{t("messages")}</dt>
              <dd className="text-[var(--color-foreground)]">
                {snapshot.messages.length}
              </dd>
            </div>
          </dl>
        </section>

        <section className="mt-6 flex flex-col gap-4">
          <h2 className="text-[14px] font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
            {t("conversation")}
          </h2>
          {snapshot.messages.length === 0 ? (
            <p className="text-[14px] italic text-[var(--color-muted-foreground)]">
              {t("noMessages")}
            </p>
          ) : (
            snapshot.messages.map((m, i) => (
              <TranscriptRow
                key={i}
                message={m}
                time={time.format(new Date(m.createdAt))}
                operatorLabel={t("operatorRoleLabel")}
              />
            ))
          )}
        </section>

        {result.expires_at && (
          <p className="mt-8 text-center text-[12px] text-[var(--color-muted-foreground)]">
            {t("linkExpiresAt", { date: dt.format(new Date(result.expires_at)) })}
          </p>
        )}
      </main>

      <div className="brand-stripe" aria-hidden>
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

function TranscriptRow({
  message,
  time,
  operatorLabel,
}: {
  message: EscalationSnapshot["messages"][number];
  time: string;
  operatorLabel: string;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="flex max-w-[92%] flex-col items-end gap-1 sm:max-w-[80%]">
          <span className="text-[11px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
            {operatorLabel} · {time}
          </span>
          <div
            className="rounded-[var(--radius-lg)] rounded-br-[10px] px-3 py-2.5 text-[15px] leading-relaxed break-words whitespace-pre-wrap shadow-[var(--shadow-sm)] sm:px-4 sm:py-3"
            style={{
              backgroundColor: "var(--color-accent)",
              color: "var(--color-primary-foreground)",
            }}
          >
            {message.content}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
        Opti Assist · {time}
      </span>
      <div className="rounded-[var(--radius)] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-3 text-[15px] sm:p-4">
        <Markdown>{message.content}</Markdown>
      </div>
    </div>
  );
}

async function ExpiredView() {
  const t = await getTranslations("escalationPage");
  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-background)]">
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-md rounded-[var(--radius)] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-8 text-center">
          <Wrench className="mx-auto h-8 w-8 text-[var(--color-muted-foreground)]" />
          <h1 className="mt-3 text-[18px] font-semibold tracking-tight text-[var(--color-foreground)]">
            {t("expiredTitle")}
          </h1>
          <p className="mt-2 text-[14px] text-[var(--color-muted-foreground)]">
            {t("expiredBody")}
          </p>
        </div>
      </div>

      <div className="brand-stripe" aria-hidden>
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
