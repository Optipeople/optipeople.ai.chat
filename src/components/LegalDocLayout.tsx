"use client";

import {
  useEffect,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { ChevronDown, List } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { TocEntry } from "@/lib/legalDocs";

// Layout wrapper for the /legal/[doc] page. Renders a sticky table of
// contents on the left at lg+, and a collapsible TOC at the top on
// smaller viewports. The article column receives `children` and remains
// the same surface card the legal page used pre-TOC.
//
// Smooth scroll is JS-driven so we can also update the URL hash without
// a full navigation. The links are real <a href="#slug"> so the page
// stays functional before JS hydrates and the anchors are deep-linkable.

export function LegalDocLayout({
  toc,
  children,
}: {
  toc: TocEntry[];
  children: ReactNode;
}) {
  const t = useTranslations("legal");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);

  // Track which heading is currently in view so the desktop sidebar can
  // highlight it. IntersectionObserver is the right tool — cheaper than
  // scroll listeners and naturally throttled.
  useEffect(() => {
    if (toc.length === 0) return;
    const elements = toc
      .map((entry) => document.getElementById(entry.slug))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Find the topmost heading that's intersecting. If none are
        // intersecting (e.g. between two headings), keep the last one we saw.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) {
          setActiveSlug(visible[0].target.id);
        }
      },
      {
        // Trigger when a heading enters the top quarter of the viewport.
        rootMargin: "-10% 0px -75% 0px",
        threshold: 0,
      },
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [toc]);

  function handleAnchorClick(
    e: ReactMouseEvent<HTMLAnchorElement>,
    slug: string,
  ) {
    e.preventDefault();
    const el = document.getElementById(slug);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      window.history.replaceState(null, "", `#${slug}`);
      setActiveSlug(slug);
    }
    setMobileOpen(false);
  }

  return (
    <>
      {/* Mobile collapsible TOC */}
      {toc.length > 0 && (
        <div className="mb-4 lg:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            aria-expanded={mobileOpen}
            className={cn(
              "flex w-full items-center justify-between gap-2 rounded-[4px] px-4 py-3 text-[14px] font-medium",
              "border border-[var(--ds-grey-light-02)] bg-[var(--color-surface)] text-[var(--color-foreground)]",
              "transition-colors hover:border-[var(--ds-grey-light-03)]",
            )}
          >
            <span className="inline-flex items-center gap-2">
              <List className="h-4 w-4 text-[var(--color-muted-foreground)]" />
              {t("tableOfContents")}
            </span>
            <ChevronDown
              className={cn(
                "h-4 w-4 text-[var(--color-muted-foreground)] transition-transform",
                mobileOpen && "rotate-180",
              )}
            />
          </button>
          {mobileOpen && (
            <ul
              className={cn(
                "mt-2 max-h-[60vh] overflow-y-auto rounded-[4px] p-2",
                "border border-[var(--ds-grey-light-02)] bg-[var(--color-surface)]",
              )}
            >
              {toc.map((item) => (
                <li key={item.slug}>
                  <a
                    href={`#${item.slug}`}
                    onClick={(e) => handleAnchorClick(e, item.slug)}
                    className={cn(
                      "block rounded-[4px] px-3 py-2 text-[14px] leading-[1.4]",
                      "transition-colors hover:bg-[var(--color-muted)]",
                      activeSlug === item.slug
                        ? "bg-[var(--color-muted)] font-medium text-[var(--color-foreground)]"
                        : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]",
                    )}
                  >
                    {item.title}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex gap-8 lg:gap-10">
        {/* Desktop sticky sidebar */}
        {toc.length > 0 && (
          <aside className="hidden w-[240px] shrink-0 lg:block">
            <nav className="sticky top-6">
              <p className="mb-3 px-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
                {t("tableOfContents")}
              </p>
              <ul className="space-y-0.5">
                {toc.map((item) => (
                  <li key={item.slug}>
                    <a
                      href={`#${item.slug}`}
                      onClick={(e) => handleAnchorClick(e, item.slug)}
                      className={cn(
                        "block rounded-[4px] px-2 py-1.5 text-[13px] leading-[1.4]",
                        "transition-colors hover:bg-[var(--color-muted)]",
                        activeSlug === item.slug
                          ? "bg-[var(--color-muted)] font-medium text-[var(--color-foreground)]"
                          : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]",
                      )}
                    >
                      {item.title}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>
        )}

        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </>
  );
}
