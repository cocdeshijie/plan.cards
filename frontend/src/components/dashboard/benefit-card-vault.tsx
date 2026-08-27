"use client";

import { useEffect, useRef, useState } from "react";
import type { CardSecretMasked, CardSecretRevealed } from "@/types";
import { copyToClipboard } from "@/lib/clipboard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  ClipboardList,
  Copy,
  CreditCard,
  EyeOff,
  Loader2,
  Lock,
} from "lucide-react";

/**
 * Stored card details, inline in a Credits & Benefits tile.
 *
 * The point is burning a credit: reveal the number, paste it into the checkout
 * in another tab, come back and log the spend in the `+$` box that is still
 * sitting right underneath. That is why the panel expands in place instead of
 * floating in a popover — a popover would cover the input you need next.
 *
 * Plaintext lives in `useCardVault`, shared with the Card details page, so
 * there is exactly one decrypted copy per card and one auto-hide timer. What
 * lives here is only which *tile* is expanded: two credits on the same card are
 * two independent panels, because opening the Uber Cash panel and having the
 * Airline Fee panel silently open too is not what anyone asked for.
 */

/**
 * On a LAN address the Clipboard API is blocked for good — `window.isSecureContext`
 * is false for http://192.168.x.x — so the legacy path is the normal path, not
 * an anomaly. Explain it once per page load; after that a successful copy is
 * just a successful copy, and the green check already says so.
 */
let fallbackExplained = false;

export type PanelState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "empty" }
  | { status: "error"; message: string };

interface VaultTriggerProps {
  benefitId: number;
  /** False when the card has no vault row — the button offers to add one. */
  stored: boolean;
  open: boolean;
  loading: boolean;
  cardName: string;
  codeLabel?: string;
  onClick: () => void;
}

export function VaultTrigger({
  benefitId,
  stored,
  open,
  loading,
  cardName,
  codeLabel,
  onClick,
}: VaultTriggerProps) {
  return (
    <Button
      size="sm"
      variant="ghost"
      data-vault-trigger={benefitId}
      aria-expanded={open}
      className={cn(
        "h-6 w-6 p-0",
        open && "text-primary bg-primary/10",
        // Dimmed rather than absent: you already store details for other cards,
        // so the gap is worth pointing at. Not 40% though — that reads as a
        // disabled control, and the tap it discouraged is the one that offers
        // to add the details. Hidden entirely when the vault is unused at all —
        // that decision lives in the widget.
        !stored && "opacity-70 hover:opacity-100",
      )}
      title={stored ? `Card number & ${codeLabel ?? "security code"}` : "No details stored — add them"}
      onClick={onClick}
    >
      {loading ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <CreditCard className="h-3 w-3" />
      )}
      <span className="sr-only">
        {!stored ? "Add" : open ? "Hide" : "Show"} card details for {cardName}
      </span>
    </Button>
  );
}

interface VaultPanelProps {
  state: PanelState;
  secret: CardSecretMasked | null;
  data: CardSecretRevealed | undefined;
  cardName: string;
  /** auth_mode === "open": no login exists on this instance. */
  authOpen: boolean;
  onClose: () => void;
  onRetry: () => void;
  onAddDetails: () => void;
}

export function VaultPanel({
  state,
  secret,
  data,
  cardName,
  authOpen,
  onClose,
  onRetry,
  onAddDetails,
}: VaultPanelProps) {
  const [copied, setCopied] = useState<string | null>(null);

  const doCopy = async (key: string, value: string, label: string) => {
    const result = await copyToClipboard(value);
    // The green check is a claim that the value is on the clipboard, so it only
    // goes up when it actually is — it used to flash alongside the red toast.
    if (result === "failed") {
      toast.error(`Couldn't copy ${label}. Select the value and copy it manually.`);
      return;
    }
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    if (result === "fallback" && !fallbackExplained) {
      fallbackExplained = true;
      toast.success(`${label} copied — via the legacy path; the Clipboard API is blocked here`);
    }
  };

  if (state.status === "loading") {
    return (
      <Shell onClose={onClose} cardName={cardName} title="Decrypting…" closable={false} />
    );
  }

  if (state.status === "empty") {
    return (
      <Shell onClose={onClose} cardName={cardName} title="No details stored">
        <p className="text-[11.5px] leading-snug text-muted-foreground">
          Nothing saved for <span className="font-medium text-foreground">{cardName}</span> yet.
        </p>
        <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={onAddDetails}>
          Add details
        </Button>
      </Shell>
    );
  }

  if (state.status === "error") {
    return (
      <Shell onClose={onClose} cardName={cardName} title="Couldn't decrypt" tone="warn">
        <p className="text-[11.5px] leading-snug text-muted-foreground">{state.message}</p>
        <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={onRetry}>
          Try again
        </Button>
      </Shell>
    );
  }

  // status === "ready" — the store is the only source of the values below.
  if (!data) return null;

  const closed = secret?.card_status === "closed";
  const codeLabel = data.code_label || secret?.code_label || "CVV";
  const allFields = [data.pan_digits, data.exp_display, data.cvv, data.billing_zip, data.holder]
    .filter(Boolean)
    .join("\n");

  return (
    <Shell
      onClose={onClose}
      cardName={cardName}
      title="Card details"
      meta={
        <>
          {data.network && (
            <span className="hidden truncate text-[10px] text-muted-foreground sm:inline" title={data.network}>
              {data.network}
            </span>
          )}
          {closed && (
            // "Closed", matching the status filter and the card list — the same
            // state was being spelled three different ways across the app.
            <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">
              Closed
            </Badge>
          )}
        </>
      }
      actions={
        <button
          type="button"
          onClick={() => doCopy("all", allFields, "All fields")}
          className="inline-flex h-[22px] min-h-[44px] shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 text-[10.5px] font-medium text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:min-h-0 sm:px-1.5"
        >
          {copied === "all" ? (
            <Check className="h-3 w-3 text-green-600 dark:text-green-500" />
          ) : (
            <ClipboardList className="h-3 w-3" />
          )}
          Copy all
        </button>
      }
    >
      {closed && (
        <p className="flex items-start gap-1.5 text-[11px] leading-snug text-amber-600 dark:text-amber-500">
          <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
          This card is closed — the number will decline.
        </p>
      )}

      {authOpen && (
        <p className="flex items-start gap-1.5 text-[11px] leading-snug text-amber-600 dark:text-amber-500">
          <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
          This instance has no login — anyone who can open this page can read this.
        </p>
      )}

      <div className="space-y-1">
        <Field
          label="Number"
          value={data.pan}
          copyLabel="Number"
          copied={copied === "pan"}
          // Bare digits: checkout fields commonly cap at maxlength=16, where
          // pasted spaces get truncated or rejected outright.
          onCopy={() => doCopy("pan", data.pan_digits, "Number")}
        />
        {/* One per line below sm: the copy targets are full-size there, and
            three of them side by side left nothing for the value itself. */}
        <div className="flex flex-wrap gap-1">
          <Field
            label="Exp"
            value={data.exp_display}
            copyLabel="Expiry"
            copied={copied === "exp"}
            onCopy={() => doCopy("exp", data.exp_display, "Expiry")}
            className="w-full sm:w-auto sm:min-w-[6.5rem] sm:flex-1"
          />
          <Field
            label={codeLabel}
            value={data.cvv}
            copyLabel={codeLabel}
            copied={copied === "cvv"}
            onCopy={() => data.cvv && doCopy("cvv", data.cvv, codeLabel)}
            className="w-full sm:w-auto sm:min-w-[6.5rem] sm:flex-1"
          />
          {/* "Postcode", not "ZIP": the field deliberately accepts letters,
              spaces and hyphens up to 16 characters, so a US-only label
              contradicts its own validation. */}
          <Field
            label="Postcode"
            value={data.billing_zip}
            copyLabel="Postcode"
            copied={copied === "zip"}
            onCopy={() => data.billing_zip && doCopy("zip", data.billing_zip, "Postcode")}
            className="w-full sm:w-auto sm:min-w-[8rem] sm:flex-1"
          />
        </div>
        {/* Dropped entirely rather than shown empty — an unfilled name row is
            noise in a tile this small. */}
        {data.holder && (
          <Field
            label="Name"
            value={data.holder}
            copyLabel="Cardholder"
            mono={false}
            copied={copied === "holder"}
            onCopy={() => doCopy("holder", data.holder!, "Cardholder")}
          />
        )}
      </div>
    </Shell>
  );
}

function Shell({
  title,
  meta,
  actions,
  tone,
  cardName,
  closable = true,
  onClose,
  children,
}: {
  title: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  tone?: "warn";
  cardName: string;
  closable?: boolean;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  // The keydown handler below only sees Escape if focus is actually inside the
  // panel, and the trigger that opened it is a *sibling* — so nothing ever
  // reached it. Take focus on open; the widget hands it back to the trigger
  // when the panel closes.
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  return (
    <div
      ref={rootRef}
      role="group"
      tabIndex={-1}
      aria-label={`Card details for ${cardName}`}
      // Escape closes just this panel. Stopped from bubbling so it can't also
      // close a dialog that happens to be hosting the widget.
      onKeyDown={(e) => {
        if (e.key === "Escape" && closable) {
          e.stopPropagation();
          onClose();
        }
      }}
      className={cn(
        // outline-none is safe on a tabIndex={-1} container: it is never
        // reached by Tab, only by the focus() above.
        "space-y-1.5 rounded-lg border p-2 outline-none",
        tone === "warn"
          ? "border-amber-500/40 bg-amber-500/[0.08]"
          : "border-primary/30 bg-primary/[0.06]",
      )}
    >
      <div className="flex items-center gap-1.5">
        {tone === "warn" ? (
          <AlertTriangle className="h-3 w-3 shrink-0 text-amber-600 dark:text-amber-500" />
        ) : (
          <Lock className="h-3 w-3 shrink-0 text-primary" />
        )}
        <span
          className={cn(
            "whitespace-nowrap text-[10px] font-semibold uppercase tracking-wider",
            tone === "warn" ? "text-amber-600 dark:text-amber-500" : "text-primary",
          )}
        >
          {title}
        </span>
        {meta}
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {actions}
          {closable && (
            <button
              type="button"
              onClick={onClose}
              className="grid h-[22px] w-[22px] min-h-[44px] min-w-[44px] place-items-center rounded-md text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:min-h-0 sm:min-w-0"
            >
              <EyeOff className="h-3 w-3" />
              <span className="sr-only">Hide card details for {cardName}</span>
            </button>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}

function Field({
  label,
  value,
  copyLabel,
  copied,
  onCopy,
  mono = true,
  className,
}: {
  label: string;
  value: string | null;
  copyLabel: string;
  copied: boolean;
  onCopy: () => void;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // min-h below sm so a stored field and an empty one are the same height
        // once the copy button is full size.
        "flex min-h-[44px] items-center gap-1.5 rounded-md bg-background/70 py-0.5 pl-2 pr-1 sm:min-h-0",
        className,
      )}
    >
      <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {value ? (
        <>
          <span
            className={cn("min-w-0 truncate text-[13px]", mono && "font-mono tabular-nums")}
            title={value}
          >
            {value}
          </span>
          <button
            type="button"
            onClick={onCopy}
            // A full-size target below sm: pasting a card number into a
            // checkout on a phone is the whole point of this panel, and 20px
            // squares 4px apart is not a target you can hit one-handed.
            className="ml-auto grid h-5 w-5 min-h-[44px] min-w-[44px] shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-primary/15 hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:min-h-0 sm:min-w-0"
          >
            {copied ? (
              <Check className="h-3 w-3 text-green-600 dark:text-green-500" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
            <span className="sr-only">Copy {copyLabel}</span>
          </button>
        </>
      ) : (
        // Never a copy button on a field that was never stored: a control that
        // copies "" is worse than no control.
        <span className="text-[13px] text-muted-foreground">—</span>
      )}
    </div>
  );
}
