"use client";

import { useState, type FormEvent } from "react";
import { ExternalLink } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { useTranslations } from "next-intl";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { CheckIcon } from "@/components/ui/icons";
import { useAuth } from "@/auth/AuthContext";
import { cn } from "@/lib/utils";

export function ConsentScreen() {
  const { acceptConsent } = useAuth();
  const t = useTranslations("consent");
  const tc = useTranslations("common");

  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [acceptAnalytics, setAcceptAnalytics] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = acceptTerms && acceptPrivacy && !submitting;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await acceptConsent(acceptAnalytics);
    } catch (err) {
      setError(err instanceof Error ? err.message : tc("unknownError"));
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex h-full flex-col bg-[var(--color-background)]">
      <AppHeader />

      <div className="flex flex-1 items-center justify-center overflow-y-auto px-4 py-6 sm:px-6 sm:py-10">
        <form
          onSubmit={handleSubmit}
          className={cn(
            "msg-in w-full max-w-xl rounded-[4px] bg-[var(--color-surface)] p-5 sm:p-8",
            "border-2 border-[var(--ds-grey-light-02)] shadow-[var(--ds-shadow-destructive)]",
          )}
        >
          <h1 className="mb-2 text-[20px] font-semibold text-[var(--color-foreground)] sm:text-[22px]">
            {t("heading")}
          </h1>
          <p className="mb-5 text-[14px] text-[var(--color-muted-foreground)] sm:mb-6 sm:text-[15px]">
            {t("subtitle")}
          </p>

          <div className="flex flex-col gap-3">
            <ConsentRow
              checked={acceptTerms}
              onChange={setAcceptTerms}
              disabled={submitting}
              required
              label={t("termsLabel")}
              linkHref="/legal/terms"
              linkLabel={t("termsLink")}
              tc={tc}
            />
            <ConsentRow
              checked={acceptPrivacy}
              onChange={setAcceptPrivacy}
              disabled={submitting}
              required
              label={t("privacyLabel")}
              linkHref="/legal/privacy"
              linkLabel={t("privacyLink")}
              tc={tc}
            />
            <ConsentRow
              checked={acceptAnalytics}
              onChange={setAcceptAnalytics}
              disabled={submitting}
              required={false}
              label={t("analyticsLabel")}
              description={t("analyticsDescription")}
            />
          </div>

          {error && (
            <p className="mt-4 text-[14px] text-[#b00020]">{error}</p>
          )}

          <div className="mt-6 flex items-center justify-end gap-3">
            <Button type="submit" disabled={!canSubmit}>
              {submitting ? (
                <Spinner className="h-4 w-4" />
              ) : (
                t("submit")
              )}
            </Button>
          </div>

          <p className="mt-6 text-[12px] leading-[1.55] text-[var(--color-muted-foreground)]">
            {t("requiredHint")}
          </p>
        </form>
      </div>

      <div className="brand-stripe shrink-0" aria-hidden>
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

function ConsentRow({
  checked,
  onChange,
  disabled,
  required,
  label,
  linkHref,
  linkLabel,
  description,
  tc,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled: boolean;
  required: boolean;
  label: string;
  linkHref?: string;
  linkLabel?: string;
  description?: string;
  tc?: ReturnType<typeof useTranslations>;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-[4px] border border-[var(--ds-grey-light-02)] bg-[var(--color-surface)] p-3 sm:p-4",
        "transition-colors hover:border-[var(--ds-grey-light-03)]",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.currentTarget.checked)}
        disabled={disabled}
        className="sr-only"
      />
      {/* Visual checkbox — replicates @/components/ui/checkbox so the
          whole card can be a single <label>. Nesting the design-system
          Checkbox (itself a <label>) inside another label is invalid HTML. */}
      <span
        aria-hidden="true"
        className={cn(
          "relative mt-[2px] inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-[1.5px] transition-colors",
          checked
            ? "bg-[var(--ds-grey-medium-07)] text-white"
            : "border-[0.5px] border-[rgba(0,0,0,0.25)] bg-white shadow-[inset_0_1px_2px_rgba(0,0,0,0.1),inset_0_0_2px_rgba(0,0,0,0.1)]",
          disabled && checked && "bg-[var(--ds-text-disabled)]",
          disabled && !checked && "border-[var(--ds-text-disabled)]",
        )}
      >
        {checked && <CheckIcon size={12} strokeWidth={2.5} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] leading-[1.5] text-[var(--ds-grey-dark-09)] sm:text-[15px]">
          {required && (
            <span aria-hidden className="mr-1 text-[var(--color-brand)]">
              *
            </span>
          )}
          {label}
        </p>
        {linkHref && linkLabel && tc && (
          <a
            href={linkHref}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="mt-1 inline-flex items-center gap-1 text-[13px] font-medium text-[var(--color-brand)] underline underline-offset-2 hover:opacity-80 sm:text-[14px]"
          >
            {linkLabel}
            <ExternalLink className="h-3 w-3" />
            <span className="sr-only">
              {tc("openInNewTab", { title: linkLabel })}
            </span>
          </a>
        )}
        {description && (
          <p className="mt-1 text-[12.5px] leading-[1.55] text-[var(--color-muted-foreground)] sm:text-[13px]">
            {description}
          </p>
        )}
      </div>
    </label>
  );
}
