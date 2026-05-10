// Read-only transcript view at /escalation/<token>.
//
// Public, token-gated. Service tech opens this from the link the
// operator generated when hitting "Tilkald service". No login. The
// transcript comes from the snapshot stored on the escalations row, not
// the live conversations/messages tables — this is a frozen handoff.

import { notFound } from "next/navigation";
import { Wrench } from "lucide-react";
import { Markdown } from "@/components/ui/markdown";
import { OptipeopleLogo } from "@/components/logo";
import type {
  EscalationChannel,
  EscalationSnapshot,
} from "@/lib/escalation";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DA_DT = new Intl.DateTimeFormat("da-DK", {
  dateStyle: "long",
  timeStyle: "short",
});

const TIME = new Intl.DateTimeFormat("da-DK", {
  timeStyle: "short",
});

const CHANNEL_LABEL: Record<EscalationChannel, string> = {
  phone: "Telefon",
  email: "E-mail",
  service_ticket: "Service-ticket",
  webhook: "Webhook",
};

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

  return (
    <div className="min-h-screen bg-[var(--color-background)]">
      <header
        className="sticky top-0 z-10 border-b border-[var(--color-hairline)]"
        style={{ backgroundColor: "var(--color-brand)" }}
      >
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-6 py-3">
          <OptipeopleLogo
            className="h-7 w-auto text-white"
            aria-label="Optipeople"
          />
          <div className="flex items-center gap-2 text-[13px] font-medium text-white/90">
            <Wrench className="h-4 w-4" />
            Service-anmodning
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8">
        <section className="rounded-[var(--radius)] border border-amber-200 bg-amber-50 p-5">
          <h1 className="text-[20px] font-semibold tracking-tight text-amber-900">
            {snapshot.machineName ?? "Ukendt maskine"}
          </h1>
          <p className="mt-1 text-[13px] text-amber-900/80">
            Tilkaldt {DA_DT.format(new Date(result.created_at))} — sendt til{" "}
            {CHANNEL_LABEL[result.channel]}{" "}
            <span className="font-mono">{result.target}</span>
          </p>
          {result.note && (
            <div className="mt-4 rounded-[var(--radius)] border border-amber-200 bg-white p-3 text-[14px]">
              <p className="text-[12px] font-medium uppercase tracking-wide text-amber-800">
                Operatørens beskrivelse
              </p>
              <p className="mt-1 whitespace-pre-wrap text-[var(--color-foreground)]">
                {result.note}
              </p>
            </div>
          )}
        </section>

        <section className="mt-6 rounded-[var(--radius)] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-5">
          <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-[13px] sm:grid-cols-3">
            <div className="flex gap-2">
              <dt className="text-[var(--color-muted-foreground)]">Operatør</dt>
              <dd className="text-[var(--color-foreground)]">
                {snapshot.operator.name ?? snapshot.operator.email ?? "—"}
                {snapshot.operator.name && snapshot.operator.email && (
                  <span className="ml-1 text-[var(--color-muted-foreground)]">
                    ({snapshot.operator.email})
                  </span>
                )}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-[var(--color-muted-foreground)]">
                Samtalen startet
              </dt>
              <dd className="text-[var(--color-foreground)]">
                {DA_DT.format(new Date(snapshot.startedAt))}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-[var(--color-muted-foreground)]">Beskeder</dt>
              <dd className="text-[var(--color-foreground)]">
                {snapshot.messages.length}
              </dd>
            </div>
          </dl>
        </section>

        <section className="mt-6 flex flex-col gap-4">
          <h2 className="text-[14px] font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
            Samtale
          </h2>
          {snapshot.messages.length === 0 ? (
            <p className="text-[14px] italic text-[var(--color-muted-foreground)]">
              Ingen beskeder i samtalen.
            </p>
          ) : (
            snapshot.messages.map((m, i) => (
              <TranscriptRow key={i} message={m} />
            ))
          )}
        </section>

        {result.expires_at && (
          <p className="mt-8 text-center text-[12px] text-[var(--color-muted-foreground)]">
            Linket udløber {DA_DT.format(new Date(result.expires_at))}.
          </p>
        )}
      </main>
    </div>
  );
}

function TranscriptRow({
  message,
}: {
  message: EscalationSnapshot["messages"][number];
}) {
  const time = TIME.format(new Date(message.createdAt));
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="flex max-w-[80%] flex-col items-end gap-1">
          <span className="text-[11px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
            Operatør · {time}
          </span>
          <div
            className="rounded-[var(--radius-lg)] rounded-br-[10px] px-4 py-3 text-[15px] leading-relaxed whitespace-pre-wrap shadow-[var(--shadow-sm)]"
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
        OptiAI · {time}
      </span>
      <div className="rounded-[var(--radius)] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-4 text-[15px]">
        <Markdown>{message.content}</Markdown>
      </div>
    </div>
  );
}

function ExpiredView() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-background)] p-6">
      <div className="max-w-md rounded-[var(--radius)] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-8 text-center">
        <Wrench className="mx-auto h-8 w-8 text-[var(--color-muted-foreground)]" />
        <h1 className="mt-3 text-[18px] font-semibold tracking-tight text-[var(--color-foreground)]">
          Linket er udløbet
        </h1>
        <p className="mt-2 text-[14px] text-[var(--color-muted-foreground)]">
          Service-anmodningen er over 30 dage gammel og er ikke længere
          tilgængelig. Kontakt operatøren for en ny anmodning.
        </p>
      </div>
    </div>
  );
}
