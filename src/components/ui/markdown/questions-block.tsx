"use client";

import { useTranslations } from "next-intl";
import { CornerDownRight } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";

/** Splits a fence body into questions: one per line, list markers stripped. */
function parseQuestions(source: string): string[] {
  return source
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*+]|\d+[.)])?\s*/, "").trim())
    .filter((line) => line.length > 0);
}

/** Follow-up questions block, rendered from a ```questions fence. */
export function QuestionsBlock({
  source,
  onAsk,
}: {
  source: string;
  onAsk?: (q: string) => void;
}) {
  const t = useTranslations("markdown");
  const questions = parseQuestions(source);
  if (questions.length === 0) return null;

  return (
    <div className="my-3">
      <div className="mb-1.5 text-[12px] font-medium text-[var(--color-muted-foreground)]">
        {t("followUps")}
      </div>
      {onAsk ? (
        <div className="flex flex-wrap gap-1.5">
          {questions.map((q, i) => (
            <button
              key={`${i}-${q}`}
              type="button"
              onClick={() => onAsk(q)}
              className={buttonClasses({
                variant: "secondary",
                size: "sm",
                className: "gap-1.5 whitespace-normal text-left leading-[16px]",
              })}
            >
              <CornerDownRight
                size={13}
                aria-hidden="true"
                className="shrink-0 text-[var(--color-muted-foreground)]"
              />
              <span>{q}</span>
            </button>
          ))}
        </div>
      ) : (
        <ul className="m-0 list-none space-y-1 p-0">
          {questions.map((q, i) => (
            <li
              key={`${i}-${q}`}
              className="flex items-start gap-1.5 text-[13px]"
            >
              <CornerDownRight
                size={13}
                aria-hidden="true"
                className="mt-[3px] shrink-0 text-[var(--color-muted-foreground)]"
              />
              <span>{q}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
