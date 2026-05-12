// Twilio wrapper. Mirrors src/lib/email.ts — lazy-loaded client so
// Next.js builds don't fail when the credentials are absent in CI
// sandboxes; only required at request time when an escalation actually
// needs to send.

import { getTranslations } from "next-intl/server";
import twilio, { type Twilio } from "twilio";
import { defaultLocale, isLocale, type Locale } from "@/i18n/config";
import { getSupabaseServerClient } from "@/lib/supabase";

export class SmsError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "SmsError";
  }
}

let cached: Twilio | null = null;

async function getClient(): Promise<Twilio> {
  if (cached) return cached;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    const t = await getTranslations("server.twilio");
    throw new SmsError(t("notConfigured"));
  }
  cached = twilio(sid, token);
  return cached;
}

async function getFrom(): Promise<string> {
  // Either a phone number (E.164) or an alphanumeric sender id /
  // Messaging Service SID — Twilio accepts all three via the same `from`
  // field. Required; we don't pick a default since the right value is
  // account-specific (verified number / approved sender).
  const from = process.env.TWILIO_FROM;
  if (!from) {
    const t = await getTranslations("server.twilio");
    throw new SmsError(t("fromNotConfigured"));
  }
  return from;
}

export type SendSmsInput = {
  to: string;
  body: string;
};

export async function sendSms(input: SendSmsInput): Promise<{ id: string }> {
  const client = await getClient();
  const from = await getFrom();
  const t = await getTranslations("server.twilio");

  try {
    const msg = await client.messages.create({
      from,
      to: input.to,
      body: input.body,
    });
    if (!msg.sid) {
      throw new SmsError(t("noMessageSid"));
    }
    return { id: msg.sid };
  } catch (err) {
    if (err instanceof SmsError) throw err;
    const detail = err instanceof Error ? err.message : t("unknownError");
    throw new SmsError(t("rejected", { detail }), err);
  }
}

// Resolves the locale to use when sending SMS / email to a given
// recipient email. Falls back to defaultLocale ('en') when no preference
// row exists or the recipient email is null (escalation phone targets).
export async function getRecipientLocale(
  email: string | null,
): Promise<Locale> {
  if (!email) return defaultLocale;
  try {
    const supabase = getSupabaseServerClient();
    const { data } = await supabase
      .from("user_preferences")
      .select("locale")
      .eq("email", email.toLowerCase())
      .maybeSingle();
    const locale = (data as { locale?: unknown } | null)?.locale;
    return isLocale(locale) ? locale : defaultLocale;
  } catch (err) {
    console.warn("getRecipientLocale: lookup failed:", err);
    return defaultLocale;
  }
}

export type RenderEscalationSmsInput = {
  machineName: string | null;
  shareUrl: string;
  locale?: Locale;
};

// Locale-aware SMS template. Short by design — one SMS segment is 160
// GSM-7 chars / 70 UCS-2 chars. Operator note is intentionally not
// included; the tech follows the share link for full context.
export async function renderEscalationSms(
  args: RenderEscalationSmsInput,
): Promise<string> {
  const locale = args.locale ?? defaultLocale;
  const t = await getTranslations({ locale, namespace: "sms.escalation" });
  const machine = args.machineName ?? t("unknownMachine");
  return t("body", { machine, url: args.shareUrl });
}
