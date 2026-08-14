"use client";

import { useEffect, type RefObject } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/**
 * Keeps keyboard focus inside `ref` while `active` is true, and returns
 * focus to the previously focused element when the trap deactivates.
 *
 * If nothing inside the container is focused when the trap activates,
 * the first focusable element receives focus — a component can still
 * set its own initial focus in a later effect (e.g. confirm-dialog
 * focusing Cancel) and that wins.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
) {
  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    if (!node.contains(document.activeElement)) {
      const first = node.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? node).focus();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab" || !node) return;
      const focusables = Array.from(
        node.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => el.getClientRects().length > 0);
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const current = document.activeElement;
      if (e.shiftKey) {
        if (current === first || !node.contains(current)) {
          e.preventDefault();
          last.focus();
        }
      } else if (current === last || !node.contains(current)) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      previouslyFocused?.focus();
    };
  }, [ref, active]);
}
