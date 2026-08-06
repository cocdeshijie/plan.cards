/**
 * Copy to clipboard, with the fallback a self-hosted deployment actually needs.
 *
 * `navigator.clipboard` is undefined outside a secure context, and a LAN address
 * like http://192.168.1.50:3000 is NOT one — only https and localhost are. That
 * is a completely normal way to reach this app, so a version that called the
 * modern API alone would work in dev on localhost and silently do nothing for
 * anyone using the app by IP. The same call can also be rejected inside an
 * iframe that wasn't granted the clipboard-write permission policy.
 *
 * Deliberately no auto-clear timer. Clearing the clipboard from a web page only
 * works while the tab still has focus, and silently no-ops the moment you switch
 * to another app to paste — which is the exact scenario it would exist for.
 * Clipboard history managers defeat it regardless. A control that doesn't do
 * what its label claims is worse than not having it, so we tell the user
 * plainly instead.
 */

export type CopyResult = "async" | "fallback" | "failed";

function legacyCopy(text: string): CopyResult {
  const previous = document.activeElement as HTMLElement | null;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0";
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, ta.value.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  previous?.focus?.();
  return ok ? "fallback" : "failed";
}

/**
 * Must be called synchronously from a click handler so the user gesture still
 * counts — never after an `await`. Fetch the value first, then copy from state.
 */
export async function copyToClipboard(text: string): Promise<CopyResult> {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return "async";
    } catch {
      return legacyCopy(text);
    }
  }
  return legacyCopy(text);
}
