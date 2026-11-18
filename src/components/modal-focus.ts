"use client";
import { useEffect, useRef } from "react";
const stack: HTMLElement[] = [];
let bodyOverflow = "";
const selector = "button,input,select,textarea,a[href],[tabindex]";
function tabbables(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(
    (el) =>
      el.tabIndex >= 0 &&
      !el.matches(":disabled") &&
      !el.closest('[inert],[hidden],[aria-hidden="true"]') &&
      el.getClientRects().length > 0,
  );
}
function focusFirst(root: HTMLElement) {
  (tabbables(root)[0] ?? root).focus({ preventScroll: true });
}
/** Focus containment follows the mounted top dialog, not global DOM query order. */
export function useModalFocus(close: () => void, enabled = true) {
  const ref = useRef<HTMLElement>(null),
    latest = useRef(close),
    opener = useRef<HTMLElement | null>(null),
    wasEnabled = useRef(false);
  if (enabled && !wasEnabled.current && typeof document !== "undefined")
    opener.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  wasEnabled.current = enabled;
  latest.current = close;
  useEffect(() => {
    const root = ref.current;
    if (!enabled || !root) return;
    const previous = opener.current;
    if (!stack.length) {
      bodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    stack.push(root);
    focusFirst(root);
    const top = () => stack.at(-1) === root;
    const key = (e: KeyboardEvent) => {
      if (!top() || e.defaultPrevented) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        latest.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = tabbables(root),
        first = items[0],
        last = items.at(-1),
        active = document.activeElement;
      if (!first) {
        e.preventDefault();
        root.focus();
      } else if (
        !root.contains(active) ||
        active === root ||
        (e.shiftKey && active === first) ||
        (!e.shiftKey && active === last)
      ) {
        e.preventDefault();
        (e.shiftKey ? last! : first).focus();
      }
    };
    const focus = (e: FocusEvent) => {
      if (top() && e.target instanceof Node && !root.contains(e.target))
        focusFirst(root);
    };
    document.addEventListener("keydown", key, true);
    document.addEventListener("focusin", focus, true);
    return () => {
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("focusin", focus, true);
      const index = stack.indexOf(root);
      if (index >= 0) stack.splice(index, 1);
      const parent = stack.at(-1);
      if (!stack.length) document.body.style.overflow = bodyOverflow;
      if (previous?.isConnected && (!parent || parent.contains(previous)))
        previous.focus({ preventScroll: true });
      else if (parent) focusFirst(parent);
    };
  }, [enabled]);
  return ref;
}
