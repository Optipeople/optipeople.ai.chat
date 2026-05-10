// Resend wrapper. Single sender, single template family for now —
// escalation hand-offs to service techs. The Resend SDK is lazy-loaded
// so Next.js builds don't fail when the key is absent in CI sandboxes
// (it's only required at request time).

import { Resend } from "resend";

export class EmailError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "EmailError";
  }
}

let cached: Resend | null = null;

function getClient(): Resend {
  if (cached) return cached;
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    throw new EmailError(
      "RESEND_API_KEY is not configured — admin must set it in Vercel env",
    );
  }
  cached = new Resend(key);
  return cached;
}

function getFrom(): string {
  // RESEND_FROM controls the visible sender. Falls back to the sandbox
  // address; that one only works because Resend allows it without
  // domain verification, but it'll trigger spam filters — set
  // RESEND_FROM to a verified-domain address in real environments.
  return process.env.RESEND_FROM ?? "OptiAI <onboarding@resend.dev>";
}

export type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
  // Optional reply-to so the tech's reply lands on the operator's
  // mailbox rather than the no-reply sender.
  replyTo?: string | null;
};

export async function sendEmail(input: SendEmailInput): Promise<{ id: string }> {
  const client = getClient();
  const from = getFrom();

  const { data, error } = await client.emails.send({
    from,
    to: [input.to],
    subject: input.subject,
    text: input.text,
    replyTo: input.replyTo ?? undefined,
  });

  if (error) {
    throw new EmailError(
      `Resend rejected email: ${error.message ?? error.name ?? "unknown"}`,
      error,
    );
  }
  if (!data?.id) {
    throw new EmailError("Resend returned no email id");
  }
  return { id: data.id };
}
