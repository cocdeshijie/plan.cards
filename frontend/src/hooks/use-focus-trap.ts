import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** A ConfirmDialog or a Radix Select portals to <body>, outside the panel, and
 *  runs its own focus management — the trap must stand down while one is open. */
const PORTALLED_OVERLAY_SELECTOR =
  '[role="dialog"], [role="alertdialog"], [data-radix-popper-content-wrapper]';

export function useFocusTrap<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Focus first focusable element
    const focusable = el.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    if (focusable.length > 0) focusable[0].focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const nodes = el.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (nodes.length === 0) return;

      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement as HTMLElement | null;

      const overlayOpen = Array.from(
        document.querySelectorAll(PORTALLED_OVERLAY_SELECTOR),
      ).some((node) => !el.contains(node));
      if (overlayOpen) return;

      // Focus fell out of the panel entirely: clicking any non-focusable area
      // of it drops activeElement to <body>, and from there every Tab walks
      // into the page behind — which is neither inert nor aria-hidden, despite
      // the panel being role="dialog" aria-modal="true". Put focus back on the
      // edge the user is tabbing towards.
      if (!active || active === document.body || active === document.documentElement) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }

      // Something outside the panel legitimately owns focus (a portal we did
      // not recognise). Leave it alone rather than yanking focus around.
      if (!el.contains(active)) return;

      if (e.shiftKey) {
        if (active === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    // On document, not on the panel: events only bubble upward, so a Tab
    // pressed while activeElement sits on <body> never reached a listener
    // attached to the panel. Capture phase so a stopPropagation() inside the
    // panel cannot disable the trap either.
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      // The trigger can already be detached: on mobile both panels open from
      // inside the drawer, which unmounts in the same commit, so .focus() on
      // the captured node is a silent no-op that strands focus on <body>.
      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus();
      } else {
        const main = document.querySelector("main");
        if (main instanceof HTMLElement) {
          if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
          main.focus();
        }
      }
    };
  }, []);

  return ref;
}
