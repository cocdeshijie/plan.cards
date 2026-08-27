"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Card, CardSecretMasked } from "@/types";
import { useAppStore } from "@/hooks/use-app-store";
import { useCardVault } from "@/hooks/use-card-vault";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { saveCardSecret, deleteCardSecret, revealCardSecret } from "@/lib/api";
import {
  KNOWN_NETWORKS,
  type CardNetwork,
  codeLabel,
  codeLength,
  detectNetwork,
  digitsOnly,
  formatPan,
  lengthValid,
  luhnValid,
  MAX_PAN_LENGTH,
  MIN_PAN_LENGTH,
  validLengths,
} from "@/lib/card-number";
import { Loader2, Lock, Check, AlertCircle, AlertTriangle, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

/** Index just after the Nth digit of a formatted string. */
function caretIndexAfterDigits(formatted: string, n: number): number {
  if (n <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (formatted[i] >= "0" && formatted[i] <= "9") {
      seen++;
      if (seen === n) return i + 1;
    }
  }
  return formatted.length;
}

/** "16, 17, 18, or 19" rather than "16 or 17 or 18 or 19". */
function orList(items: readonly number[]): string {
  const parts = items.map(String);
  try {
    return new Intl.ListFormat("en", { style: "long", type: "disjunction" }).format(parts);
  } catch {
    // Intl.ListFormat is missing on a handful of older WebViews.
    return parts.join(" or ");
  }
}

/** The plaintext fields, as a comparable snapshot. */
interface SecretDraft {
  pan: string;
  exp: string;
  cvv: string;
  zip: string;
  holder: string;
  override: string;
}

const EMPTY_DRAFT: SecretDraft = { pan: "", exp: "", cvv: "", zip: "", holder: "", override: "auto" };

interface CardSecretDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  cards: Card[];
  /** Pre-selected card, when opened from a specific row. */
  cardId?: number | null;
  /** Present when editing, so the dialog can offer Delete. */
  existing?: CardSecretMasked | null;
  /** Opened from a specific card, so the picker shouldn't be changeable. */
  lockCard?: boolean;
}

export function CardSecretDialog({
  open,
  onClose,
  onSaved,
  cards,
  cardId = null,
  existing = null,
  lockCard = false,
}: CardSecretDialogProps) {
  const profiles = useAppStore((st) => st.profiles);
  const [selectedId, setSelectedId] = useState<string>(cardId ? String(cardId) : "");
  const [pan, setPan] = useState("");
  const [exp, setExp] = useState("");
  const [cvv, setCvv] = useState("");
  const [zip, setZip] = useState("");
  const [holder, setHolder] = useState("");
  const [override, setOverride] = useState<string>("auto");
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  /** Set when the stored row could not be decrypted — see the panel below. */
  const [loadError, setLoadError] = useState<string | null>(null);
  /** The user chose to type fresh values over a record that wouldn't decrypt. */
  const [replaceUndecryptable, setReplaceUndecryptable] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  /** Number and security code shown as dots. Flipped on by "Hide all" and by
   *  the vault's auto-hide timer, which otherwise never reach this form. */
  const [masked, setMasked] = useState(false);
  const panRef = useRef<HTMLInputElement>(null);
  const caretRef = useRef<number | null>(null);
  const expRef = useRef<HTMLInputElement>(null);
  const expCaretRef = useRef<number | null>(null);
  const [holderTouched, setHolderTouched] = useState(false);

  // Ids are per-instance: three screens mount a CardSecretDialog, and a
  // hardcoded "secret-pan" would collide the moment two of them were alive.
  const uid = useId();
  const cardFieldId = `${uid}-card`;
  const panId = `${uid}-pan`;
  const panMsgId = `${uid}-pan-msg`;
  const expId = `${uid}-exp`;
  const expMsgId = `${uid}-exp-msg`;
  const cvvId = `${uid}-cvv`;
  const cvvMsgId = `${uid}-cvv-msg`;
  const zipId = `${uid}-zip`;
  const holderId = `${uid}-holder`;
  const holderMsgId = `${uid}-holder-msg`;
  const networkId = `${uid}-network`;
  const saveHintId = `${uid}-save-hint`;

  /**
   * Cardholder defaults to the card's profile name, but ONLY while no details
   * have been stored yet. Once an entry exists we show exactly what was saved —
   * including a name the user deliberately cleared — rather than reintroducing
   * a default they already rejected.
   *
   * Held in a ref rather than a useCallback in the effect's deps: `cards` and
   * `profiles` come from the app store and change identity on a background
   * refresh, which would re-run the open effect and wipe a half-filled form.
   */
  const holderDefaultRef = useRef<(cid: number | null) => string>(() => "");
  holderDefaultRef.current = (cid) => {
    if (cid == null) return "";
    const c = cards.find((x) => x.id === cid);
    if (!c) return "";
    // Uppercase to match how names are printed on cards, and how the field
    // normalises anything the user types into it.
    return (profiles.find((pr) => pr.id === c.profile_id)?.name ?? "").toUpperCase();
  };

  /** What the form looked like when it was handed to the user, so Esc can tell
   *  a typed card number from an untouched one. */
  const baselineRef = useRef<SecretDraft>(EMPTY_DRAFT);
  // onClose is written inline by every call site, so a new identity each render.
  // Kept in a ref so the window listener below subscribes once per open.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Restore the caret after a reformatted value commits to the DOM. Both masked
  // fields reformat as you type, so both need it.
  useLayoutEffect(() => {
    if (caretRef.current !== null && panRef.current) {
      panRef.current.setSelectionRange(caretRef.current, caretRef.current);
      caretRef.current = null;
    }
    if (expCaretRef.current !== null && expRef.current) {
      expRef.current.setSelectionRange(expCaretRef.current, expCaretRef.current);
      expCaretRef.current = null;
    }
  });

  const cardLabel = (c: Card) =>
    `${c.issuer} ${c.card_name}${c.last_digits ? ` ···${c.last_digits}` : ""}`;
  const profileNameFor = (c: Card) =>
    profiles.find((pr) => pr.id === c.profile_id)?.name ?? "—";

  const digits = digitsOnly(pan);
  const detected = useMemo(() => detectNetwork(digits), [digits]);
  const network: CardNetwork | null = override === "auto" ? detected : (override as CardNetwork);

  // Load the current values when editing. Opening the editor is an explicit
  // action, so fetching plaintext here is the same trust step as revealing.
  useEffect(() => {
    if (!open) return;
    const initialHolder = existing ? "" : holderDefaultRef.current(cardId);
    // Preserve a stored override so the editor labels the security code the way
    // the saved card does, rather than re-deriving it from the prefix.
    const initialOverride = existing?.network ?? "auto";
    setSelectedId(cardId ? String(cardId) : "");
    setPan("");
    setExp("");
    setCvv("");
    setZip("");
    setHolder(initialHolder);
    setHolderTouched(false);
    setOverride(initialOverride);
    setMasked(false);
    setLoadError(null);
    setReplaceUndecryptable(false);
    baselineRef.current = { ...EMPTY_DRAFT, holder: initialHolder, override: initialOverride };
    if (!cardId || !existing) return;
    setLoading(true);
    revealCardSecret(cardId)
      .then((data) => {
        const loaded: SecretDraft = {
          pan: data.pan,
          exp: `${String(data.exp_month).padStart(2, "0")}/${String(data.exp_year % 100).padStart(2, "0")}`,
          cvv: data.cvv ?? "",
          zip: data.billing_zip ?? "",
          holder: data.holder ?? "",
          override: initialOverride,
        };
        setPan(loaded.pan);
        setExp(loaded.exp);
        setCvv(loaded.cvv);
        setZip(loaded.zip);
        setHolder(loaded.holder);
        baselineRef.current = loaded;
      })
      .catch((e) => {
        // A toast alone left an empty "Edit card details" form that looked
        // exactly like an unstored card — and typing into it would overwrite a
        // row that was fine. Say what happened and make the overwrite explicit.
        const message = e instanceof Error ? e.message : "Could not load details";
        setLoadError(message);
        toast.error(message);
      })
      .finally(() => setLoading(false));
  }, [open, cardId, existing, reloadNonce]);

  /**
   * Wipe plaintext out of component state after close.
   *
   * Deferred past the exit animation on purpose: clearing on the same tick
   * blanked four of the five fields while the dialog was still fading, so the
   * last thing the user saw was a half-erased form. `exp` used to be missed
   * entirely, which is what made the wipe visible in the first place.
   */
  useEffect(() => {
    if (open) return;
    const t = setTimeout(() => {
      setPan("");
      setExp("");
      setCvv("");
      setZip("");
      setHolder("");
      baselineRef.current = EMPTY_DRAFT;
    }, 250);
    return () => clearTimeout(t);
  }, [open]);

  /**
   * The store's "what clears plaintext" contract has to hold here too, and this
   * form is the one place plaintext lives outside `useCardVault`:
   *  - a 401 wipes the fields and closes, exactly as it empties the vault;
   *  - "Hide all" and the auto-hide timer mask the number and code rather than
   *    closing, because throwing away a half-typed card number to satisfy a
   *    timer is worse than showing dots.
   */
  useEffect(() => {
    if (!open) return;
    const onUnauthorized = () => {
      setPan("");
      setExp("");
      setCvv("");
      setZip("");
      setHolder("");
      baselineRef.current = EMPTY_DRAFT;
      onCloseRef.current();
    };
    window.addEventListener("auth:unauthorized", onUnauthorized);
    const unsubscribe = useCardVault.subscribe((state, prev) => {
      if (Object.keys(prev.revealed).length > 0 && Object.keys(state.revealed).length === 0) {
        setMasked(true);
      }
    });
    return () => {
      window.removeEventListener("auth:unauthorized", onUnauthorized);
      unsubscribe();
    };
  }, [open]);

  /**
   * Reformat as you type, preserving the caret.
   *
   * Two bugs live here if you're not careful:
   *
   * 1. Clamping to `maxPanLength(network)` where `network` came from the
   *    PREVIOUS keystroke silently ate digits. Paste a 16-digit Visa over an
   *    Amex and you got 15 digits plus "fails its check digit — likely a typo",
   *    blaming the user for a digit the field deleted. So clamp only at the
   *    absolute maximum and let the length message do the talking.
   * 2. Reassigning a controlled input's value resets the caret to the end, so
   *    every mid-string correction jumped. Count the digits before the caret,
   *    then put it back after that many digits in the reformatted string.
   */
  const commitPan = (rawValue: string, caretInRaw: number) => {
    const digitsBefore = digitsOnly(rawValue.slice(0, caretInRaw)).length;
    const d = digitsOnly(rawValue).slice(0, MAX_PAN_LENGTH);
    const net = override === "auto" ? detectNetwork(d) : (override as CardNetwork);
    const formatted = formatPan(d, net);
    caretRef.current = caretIndexAfterDigits(formatted, digitsBefore);
    setPan(formatted);
  };

  const handlePan = (e: React.ChangeEvent<HTMLInputElement>) => {
    commitPan(e.target.value, e.target.selectionStart ?? e.target.value.length);
  };

  /** Backspace over a group separator should delete the digit before it, not
   *  silently re-add the space and leave the caret stranded at the end. */
  const handlePanKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Backspace") return;
    const el = e.currentTarget;
    const start = el.selectionStart ?? 0;
    if (start !== el.selectionEnd || start < 2) return;
    if (el.value[start - 1] !== " ") return;
    e.preventDefault();
    commitPan(el.value.slice(0, start - 2) + el.value.slice(start), start - 2);
  };

  /**
   * Same caret bookkeeping as the number field.
   *
   * There is deliberately no `maxLength`: at 5 characters a complete "12/25"
   * refuses every insertion, so correcting the month meant clearing the whole
   * field. Four digits is the real limit and it is enforced here instead.
   */
  const commitExp = (rawValue: string, caretInRaw: number) => {
    let digitsBefore = digitsOnly(rawValue.slice(0, caretInRaw)).length;
    let d = digitsOnly(rawValue).slice(0, 4);
    // Typing "9" for September should become "09" rather than waiting for a
    // second digit that will never come — and the caret belongs after the pair,
    // not between the zero and the nine.
    if (d.length === 1 && Number(d) > 1) {
      d = `0${d}`;
      digitsBefore += 1;
    }
    const formatted = d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
    expCaretRef.current = caretIndexAfterDigits(formatted, digitsBefore);
    setExp(formatted);
  };

  const handleExp = (e: React.ChangeEvent<HTMLInputElement>) => {
    commitExp(e.target.value, e.target.selectionStart ?? e.target.value.length);
  };

  /** Backspacing the "/" used to produce "1225", which reformatted straight
   *  back to "12/25" — the keypress looked like it did nothing. Delete the
   *  digit in front of the separator instead. */
  const handleExpKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Backspace") return;
    const el = e.currentTarget;
    const start = el.selectionStart ?? 0;
    if (start !== el.selectionEnd || start < 2) return;
    if (el.value[start - 1] !== "/") return;
    e.preventDefault();
    commitExp(el.value.slice(0, start - 2) + el.value.slice(start), start - 2);
  };

  const expParts = exp.match(/^(\d{2})\/(\d{2})$/);
  const expMonth = expParts ? Number(expParts[1]) : 0;
  const expYear = expParts ? 2000 + Number(expParts[2]) : 0;
  const expWellFormed = !!expParts && expMonth >= 1 && expMonth <= 12;
  // A card is valid through the end of its expiry month. Past is a WARNING, not
  // an error: every stored 2025 entry would otherwise open with a red field and
  // a permanently disabled Save, leaving Delete as the only way out of the
  // dialog — including for the closed cards this page keeps a filter chip for.
  const expPast = expWellFormed && new Date(expYear, expMonth, 1) <= new Date();

  const lenOk = lengthValid(digits, network);
  const luhnOk = luhnValid(digits);
  const cvvOk = cvv.length === 0 || cvv.length === codeLength(network);
  const canSave = !!selectedId && lenOk && luhnOk && expWellFormed && cvvOk && !loading;

  const panMessage = (() => {
    if (!digits.length) return null;
    if (!network) return { kind: "hint" as const, text: "Network not recognised — pick one below if you know it." };
    if (!lenOk) {
      // Below the shortest PAN any network issues, "you have 4 digits" is just
      // telling someone mid-type that they haven't finished typing.
      if (digits.length < MIN_PAN_LENGTH) {
        return { kind: "hint" as const, text: `${network} · ${digits.length} digits` };
      }
      return {
        kind: "hint" as const,
        text: `${network} numbers are ${orList(validLengths(network))} digits. You have ${digits.length}.`,
      };
    }
    if (!luhnOk) return { kind: "bad" as const, text: "That number fails its check digit — likely a typo." };
    return { kind: "good" as const, text: `${network} · ${digits.length} digits · check digit valid` };
  })();

  const expMessage = (() => {
    if (exp.length === 5 && !expWellFormed) {
      return { kind: "bad" as const, text: "That isn't a real month — use MM/YY." };
    }
    if (expPast) return { kind: "warn" as const, text: "This date has passed." };
    return null;
  })();

  // Save is disabled far more often than it is enabled, and a disabled button
  // with no explanation is the single most common complaint about this form.
  const saveBlocker = (() => {
    // The "Decrypting…" line above already says why Save is dead right now.
    if (loading) return null;
    if (!selectedId) return "Pick a card first.";
    if (!digits.length) return "Enter the card number.";
    if (!lenOk || !luhnOk) return "Check the card number.";
    if (!expWellFormed) return "Enter the expiry as MM/YY.";
    if (!cvvOk) return `${codeLabel(network)} must be ${codeLength(network)} digits.`;
    return null;
  })();

  /** Anything the user typed that isn't in the baseline the form opened with. */
  const isDirty = () => {
    if (loading) return false;
    const b = baselineRef.current;
    return (
      pan !== b.pan ||
      exp !== b.exp ||
      cvv !== b.cvv ||
      zip !== b.zip ||
      (holderTouched && holder !== b.holder) ||
      override !== b.override
    );
  };

  // Esc and overlay clicks used to throw away a fully typed card number without
  // asking. Same guard the card editor uses.
  const requestClose = () => {
    if (submitting) return;
    if (isDirty()) setConfirmDiscard(true);
    else onClose();
  };

  const handleSave = async () => {
    if (!canSave || submitting) return;
    setSubmitting(true);
    try {
      await saveCardSecret(Number(selectedId), {
        pan: digits,
        exp_month: expMonth,
        exp_year: expYear,
        cvv: cvv || null,
        holder: holder || null,
        billing_zip: zip || null,
        network: override === "auto" ? null : override,
      });
      // Drop any revealed copy of the OLD values — otherwise the vault row
      // keeps showing, and copying, the pre-edit number until auto-hide fires.
      // Done here rather than at each call site so every caller gets it.
      useCardVault.getState().hide(Number(selectedId));
      toast.success("Card details saved");
      baselineRef.current = { pan, exp, cvv, zip, holder, override };
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save card details");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!cardId) return;
    setSubmitting(true);
    try {
      await deleteCardSecret(cardId);
      useCardVault.getState().hide(cardId);
      toast.success("Card details deleted");
      baselineRef.current = EMPTY_DRAFT;
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete card details");
    } finally {
      setSubmitting(false);
      setConfirmDelete(false);
    }
  };

  const retryLoad = useCallback(() => {
    setLoadError(null);
    setReloadNonce((n) => n + 1);
  }, []);

  const showForm = !loadError || replaceUndecryptable;

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && requestClose()}>
        {/* overflow-x-hidden is a backstop: setting overflow-y alone makes the
            other axis compute to `auto`, so any over-wide child scrolls the
            whole form sideways. A form dialog never wants that. */}
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto overflow-x-hidden">
          <DialogHeader>
            <DialogTitle>{existing ? "Edit card details" : "Add card details"}</DialogTitle>
            <DialogDescription>
              Optional. Everything here is encrypted before it reaches the database.
            </DialogDescription>
          </DialogHeader>

          {/* The form stays mounted while the stored values decrypt — swapping
              it for a bare centred spinner collapsed the dialog to ~150px and
              then snapped it back to full height, growing in both directions
              from the centre. The fields are simply disabled until it lands. */}
          {loading && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Decrypting the stored details…
            </p>
          )}

          {loadError && (
            <div className="flex gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/[0.08] p-3">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-500" />
              <div className="space-y-2 text-xs text-muted-foreground">
                <p>
                  <span className="font-medium text-foreground">
                    Couldn&apos;t decrypt this card&apos;s stored details.
                  </span>{" "}
                  {loadError}
                </p>
                <p>
                  The encrypted row is still there — this is not an empty card. If this instance was
                  restored from a database backup without{" "}
                  <code className="text-[11px]">/data/.encryption_key</code>, the stored values
                  cannot be recovered and re-entering them is the only fix.
                </p>
                {!replaceUndecryptable && (
                  <div className="flex flex-wrap gap-2 pt-0.5">
                    <Button type="button" size="sm" variant="outline" onClick={retryLoad}>
                      Try again
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setReplaceUndecryptable(true)}
                    >
                      Replace with new details
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="text-danger"
                      onClick={() => setConfirmDelete(true)}
                      disabled={submitting}
                    >
                      Delete details
                    </Button>
                  </div>
                )}
                {replaceUndecryptable && (
                  <p className="font-medium text-foreground">
                    Saving now replaces the stored record. Nothing is overwritten until you press
                    Save.
                  </p>
                )}
              </div>
            </div>
          )}

          {showForm && (
            // A real <form>: Enter submits from any field, which is how every
            // other credential form in the app already behaves.
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSave();
              }}
              className="space-y-3"
            >
              <div>
                <Label htmlFor={cardFieldId}>Which card?</Label>
                <Select
                  value={selectedId}
                  onValueChange={(v) => {
                    setSelectedId(v);
                    // Track the newly chosen card's owner, unless the user has
                    // already written a name of their own.
                    if (!existing && !holderTouched) {
                      setHolder(holderDefaultRef.current(Number(v)));
                    }
                  }}
                  disabled={!!existing || lockCard || loading}
                >
                  <SelectTrigger
                    id={cardFieldId}
                    title={
                      selectedId
                        ? cards
                            .filter((c) => String(c.id) === selectedId)
                            .map((c) => `${profileNameFor(c)} · ${cardLabel(c)}`)[0]
                        : undefined
                    }
                  >
                    <SelectValue placeholder="Select a card…" />
                  </SelectTrigger>
                  {/* Cap the menu at the field's width — card names are
                      user-supplied and can be long enough to balloon the
                      popover past the viewport otherwise. */}
                  <SelectContent className="max-w-[var(--radix-select-trigger-width)]">
                    {cards.map((c) => (
                      <SelectItem
                        key={c.id}
                        value={String(c.id)}
                        title={`${profileNameFor(c)} · ${cardLabel(c)}`}
                        className="overflow-hidden [&>span:last-child]:min-w-0 [&>span:last-child]:truncate"
                      >
                        <span className="text-xs text-muted-foreground mr-1.5">
                          {profileNameFor(c)}
                        </span>
                        {cardLabel(c)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor={panId}>Card number</Label>
                  <button
                    type="button"
                    onClick={() => setMasked((m) => !m)}
                    // No aria-pressed: the accessible name below names the ACTION
                    // ("Show…"/"Hide…") and flips with state, so a pressed state
                    // would always announce the opposite of the label.
                    // 44px of touch target without 44px of layout: the negative
                    // margin gives most of the growth back to the label row.
                    className="inline-flex min-h-[44px] -my-1.5 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring outline-none sm:min-h-0 sm:my-0 sm:py-1"
                  >
                    {masked ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    {masked ? "Show" : "Hide"}
                    <span className="sr-only"> the number and security code</span>
                  </button>
                </div>
                <Input
                  id={panId}
                  ref={panRef}
                  type={masked ? "password" : "text"}
                  value={pan}
                  onChange={handlePan}
                  onKeyDown={handlePanKeyDown}
                  inputMode="numeric"
                  enterKeyHint="next"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={loading}
                  placeholder="0000 0000 0000 0000"
                  aria-describedby={panMessage ? panMsgId : undefined}
                  aria-invalid={panMessage?.kind === "bad" || undefined}
                  className="font-mono tabular-nums tracking-wider"
                />
                {panMessage && (
                  <p
                    id={panMsgId}
                    className={`text-xs mt-1 flex items-center gap-1 ${
                      panMessage.kind === "bad"
                        ? "text-danger"
                        : panMessage.kind === "good"
                          ? "text-green-600 dark:text-green-500"
                          : "text-muted-foreground"
                    }`}
                  >
                    {panMessage.kind === "bad" && <AlertCircle className="h-3 w-3 shrink-0" />}
                    {panMessage.kind === "good" && <Check className="h-3 w-3 shrink-0" />}
                    {panMessage.text}
                  </p>
                )}
              </div>

              {/* One column on a phone: three ~101px cells wrapped
                  "Security code is 4 digits." onto three lines. */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <Label htmlFor={expId}>Expires</Label>
                  <Input
                    id={expId}
                    ref={expRef}
                    value={exp}
                    onChange={handleExp}
                    onKeyDown={handleExpKeyDown}
                    inputMode="numeric"
                    enterKeyHint="next"
                    autoComplete="off"
                    disabled={loading}
                    placeholder="MM/YY"
                    aria-describedby={expMessage ? expMsgId : undefined}
                    aria-invalid={expMessage?.kind === "bad" || undefined}
                    className="font-mono tabular-nums"
                  />
                  {expMessage && (
                    <p
                      id={expMsgId}
                      className={`text-xs mt-1 ${
                        expMessage.kind === "bad"
                          ? "text-danger"
                          : "text-amber-600 dark:text-amber-500"
                      }`}
                    >
                      {expMessage.text}
                    </p>
                  )}
                </div>
                <div>
                  <Label htmlFor={cvvId}>{codeLabel(network)}</Label>
                  <Input
                    id={cvvId}
                    type={masked ? "password" : "text"}
                    value={cvv}
                    onChange={(e) => setCvv(digitsOnly(e.target.value).slice(0, codeLength(network)))}
                    inputMode="numeric"
                    enterKeyHint="next"
                    autoComplete="off"
                    disabled={loading}
                    placeholder={codeLength(network) === 4 ? "0000" : "000"}
                    aria-describedby={cvv.length > 0 && !cvvOk ? cvvMsgId : undefined}
                    aria-invalid={(cvv.length > 0 && !cvvOk) || undefined}
                    className="font-mono tabular-nums"
                  />
                  {/* Without this, changing the network after typing the code
                      left Save disabled with nothing explaining why. */}
                  {cvv.length > 0 && !cvvOk ? (
                    <p id={cvvMsgId} className="text-xs mt-1 text-danger">
                      {codeLabel(network)} is {codeLength(network)} digits.
                    </p>
                  ) : network === "Amex" ? (
                    <p className="text-xs mt-1 text-muted-foreground">4 digits, front</p>
                  ) : null}
                </div>
                <div>
                  {/* "Postcode", not "ZIP": the field below deliberately accepts
                      letters, spaces and hyphens up to 16 characters, so a
                      US-only label contradicts its own validation. */}
                  <Label htmlFor={zipId}>Billing postcode</Label>
                  <Input
                    id={zipId}
                    value={zip}
                    onChange={(e) => setZip(e.target.value.replace(/[^0-9A-Za-z -]/g, "").slice(0, 16))}
                    autoComplete="off"
                    enterKeyHint="next"
                    disabled={loading}
                    placeholder="90210"
                    className="font-mono tabular-nums"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor={holderId}>Cardholder name</Label>
                <Input
                  id={holderId}
                  value={holder}
                  onChange={(e) => {
                    setHolderTouched(true);
                    setHolder(e.target.value.slice(0, 100));
                  }}
                  onBlur={() => setHolder((h) => h.toUpperCase())}
                  autoComplete="off"
                  enterKeyHint="done"
                  spellCheck={false}
                  disabled={loading}
                  placeholder="As printed on the card"
                  aria-describedby={
                    !existing && !holderTouched && holder ? holderMsgId : undefined
                  }
                />
                {!existing && !holderTouched && holder && (
                  <p id={holderMsgId} className="text-xs mt-1 text-muted-foreground">
                    Prefilled from the profile name — edit if the card says something else.
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor={networkId}>Network</Label>
                <Select value={override} onValueChange={setOverride} disabled={loading}>
                  <SelectTrigger id={networkId}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">
                      Detected from the number{detected ? ` — ${detected}` : ""}
                    </SelectItem>
                    {KNOWN_NETWORKS.map((n) => (
                      <SelectItem key={n} value={n}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs mt-1 text-muted-foreground">
                  {detected && override !== "auto" && override !== detected
                    ? `Detected ${detected} from the number; you've overridden it to ${override}.`
                    : "Some cards are co-badged — your answer wins over the detected value."}
                </p>
              </div>

              <div className="flex gap-2 rounded-xl border bg-muted/40 p-3 text-xs text-muted-foreground">
                <Lock className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>
                  Encrypted with a key held on this server, in a table separate from the rest of the
                  card record. Never included in the JSON profile export. A database backup contains
                  it encrypted but <strong className="font-medium text-foreground">does not include
                  the key</strong> — keep <code className="text-[11px]">/data/.encryption_key</code>{" "}
                  if you want to restore elsewhere. Anyone who can sign in here, or who can read both
                  the database and the key file, can read these values.
                </span>
              </div>

              <div className="space-y-1.5 pt-1">
                <div className="flex gap-2">
                  {existing && (
                    <Button
                      type="button"
                      variant="outline"
                      className="text-danger"
                      onClick={() => setConfirmDelete(true)}
                      disabled={submitting}
                    >
                      Delete
                    </Button>
                  )}
                  <Button
                    type="submit"
                    className="flex-1"
                    disabled={!canSave || submitting}
                    aria-describedby={saveBlocker && !submitting ? saveHintId : undefined}
                  >
                    {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                    {submitting ? "Saving…" : existing ? "Save changes" : "Save details"}
                  </Button>
                </div>
                {/* Announced, not just greyed out — Save spends most of its life
                    disabled and never used to say why. */}
                {saveBlocker && !submitting && (
                  <p id={saveHintId} aria-live="polite" className="text-xs text-muted-foreground">
                    {saveBlocker}
                  </p>
                )}
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete card details?"
        description="The stored number, security code, name and postcode for this card will be removed. The card itself stays."
        confirmLabel="Delete details"
        pendingLabel="Deleting…"
        variant="destructive"
        loading={submitting}
        onConfirm={handleDelete}
      />

      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="Discard these details?"
        description="The number, expiry and security code you've typed here haven't been saved and will be lost."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        variant="destructive"
        onConfirm={() => {
          setConfirmDiscard(false);
          onClose();
        }}
      />
    </>
  );
}
