"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  validLengths,
} from "@/lib/card-number";
import { Loader2, Lock, Check, AlertCircle } from "lucide-react";
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
  const panRef = useRef<HTMLInputElement>(null);
  const caretRef = useRef<number | null>(null);
  const [holderTouched, setHolderTouched] = useState(false);

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

  // Restore the caret after the reformatted value commits to the DOM.
  useLayoutEffect(() => {
    if (caretRef.current !== null && panRef.current) {
      panRef.current.setSelectionRange(caretRef.current, caretRef.current);
      caretRef.current = null;
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
    if (!open) {
      // Don't leave decrypted values sitting in component state after close —
      // the store's "what clears plaintext" contract has to hold here too.
      setPan("");
      setCvv("");
      setZip("");
      setHolder("");
      return;
    }
    setSelectedId(cardId ? String(cardId) : "");
    setPan("");
    setExp("");
    setCvv("");
    setZip("");
    setHolder(existing ? "" : holderDefaultRef.current(cardId));
    setHolderTouched(false);
    // Preserve a stored override so the editor labels the security code the way
    // the saved card does, rather than re-deriving it from the prefix.
    setOverride(existing?.network ?? "auto");
    if (!cardId || !existing) return;
    setLoading(true);
    revealCardSecret(cardId)
      .then((data) => {
        setPan(data.pan);
        setExp(`${String(data.exp_month).padStart(2, "0")}/${String(data.exp_year % 100).padStart(2, "0")}`);
        setCvv(data.cvv ?? "");
        setZip(data.billing_zip ?? "");
        setHolder(data.holder ?? "");
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Could not load details"))
      .finally(() => setLoading(false));
  }, [open, cardId, existing]);

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

  const handleExp = (value: string) => {
    let d = digitsOnly(value).slice(0, 4);
    // Typing "9" for September should become "09/" rather than waiting for a
    // second digit that will never come.
    if (d.length === 1 && Number(d) > 1) d = `0${d}`;
    setExp(d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d);
  };

  const expParts = exp.match(/^(\d{2})\/(\d{2})$/);
  const expMonth = expParts ? Number(expParts[1]) : 0;
  const expYear = expParts ? 2000 + Number(expParts[2]) : 0;
  const expValid =
    !!expParts &&
    expMonth >= 1 &&
    expMonth <= 12 &&
    // A card is valid through the end of its expiry month.
    new Date(expYear, expMonth, 1) > new Date();

  const lenOk = lengthValid(digits, network);
  const luhnOk = luhnValid(digits);
  const cvvOk = cvv.length === 0 || cvv.length === codeLength(network);
  const canSave = !!selectedId && lenOk && luhnOk && expValid && cvvOk && !loading;

  const panMessage = (() => {
    if (!digits.length) return null;
    if (!network) return { kind: "hint" as const, text: "Network not recognised — pick one below if you know it." };
    if (!lenOk) {
      return {
        kind: "hint" as const,
        text: `${network} numbers are ${validLengths(network).join(" or ")} digits. You have ${digits.length}.`,
      };
    }
    if (!luhnOk) return { kind: "bad" as const, text: "That number fails its check digit — likely a typo." };
    return { kind: "good" as const, text: `${network} · ${digits.length} digits · check digit valid` };
  })();

  const handleSave = async () => {
    if (!canSave) return;
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
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete card details");
    } finally {
      setSubmitting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
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

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <Label htmlFor="secret-card">Which card?</Label>
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
                  disabled={!!existing || lockCard}
                >
                  <SelectTrigger
                    id="secret-card"
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
                <Label htmlFor="secret-pan">Card number</Label>
                <Input
                  id="secret-pan"
                  ref={panRef}
                  value={pan}
                  onChange={handlePan}
                  onKeyDown={handlePanKeyDown}
                  inputMode="numeric"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="0000 0000 0000 0000"
                  className="font-mono tabular-nums tracking-wider"
                />
                {panMessage && (
                  <p
                    className={`text-xs mt-1 flex items-center gap-1 ${
                      panMessage.kind === "bad"
                        ? "text-destructive"
                        : panMessage.kind === "good"
                          ? "text-green-600 dark:text-green-500"
                          : "text-muted-foreground"
                    }`}
                  >
                    {panMessage.kind === "bad" && <AlertCircle className="h-3 w-3" />}
                    {panMessage.kind === "good" && <Check className="h-3 w-3" />}
                    {panMessage.text}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label htmlFor="secret-exp">Expires</Label>
                  <Input
                    id="secret-exp"
                    value={exp}
                    onChange={(e) => handleExp(e.target.value)}
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="MM/YY"
                    maxLength={5}
                    className="font-mono tabular-nums"
                  />
                  {exp.length === 5 && !expValid && (
                    <p className="text-xs mt-1 text-destructive">Invalid or past date.</p>
                  )}
                </div>
                <div>
                  <Label htmlFor="secret-cvv">{codeLabel(network)}</Label>
                  <Input
                    id="secret-cvv"
                    value={cvv}
                    onChange={(e) => setCvv(digitsOnly(e.target.value).slice(0, codeLength(network)))}
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder={codeLength(network) === 4 ? "0000" : "000"}
                    className="font-mono tabular-nums"
                  />
                  {/* Without this, changing the network after typing the code
                      left Save disabled with nothing explaining why. */}
                  {cvv.length > 0 && !cvvOk ? (
                    <p className="text-xs mt-1 text-destructive">
                      {codeLabel(network)} is {codeLength(network)} digits.
                    </p>
                  ) : network === "Amex" ? (
                    <p className="text-xs mt-1 text-muted-foreground">4 digits, front</p>
                  ) : null}
                </div>
                <div>
                  <Label htmlFor="secret-zip">Billing ZIP</Label>
                  <Input
                    id="secret-zip"
                    value={zip}
                    onChange={(e) => setZip(e.target.value.replace(/[^0-9A-Za-z -]/g, "").slice(0, 16))}
                    autoComplete="off"
                    placeholder="00000"
                    className="font-mono tabular-nums"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="secret-holder">Cardholder name</Label>
                <Input
                  id="secret-holder"
                  value={holder}
                  onChange={(e) => {
                    setHolderTouched(true);
                    setHolder(e.target.value.slice(0, 100));
                  }}
                  onBlur={() => setHolder((h) => h.toUpperCase())}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="As printed on the card"
                />
                {!existing && !holderTouched && holder && (
                  <p className="text-xs mt-1 text-muted-foreground">
                    Prefilled from the profile name — edit if the card says something else.
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="secret-network">Network</Label>
                <Select value={override} onValueChange={setOverride}>
                  <SelectTrigger id="secret-network">
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

              <div className="flex gap-2 pt-1">
                {existing && (
                  <Button
                    variant="outline"
                    className="text-destructive"
                    onClick={() => setConfirmDelete(true)}
                    disabled={submitting}
                  >
                    Delete
                  </Button>
                )}
                <Button className="flex-1" onClick={handleSave} disabled={!canSave || submitting}>
                  {submitting ? "Saving…" : existing ? "Save changes" : "Save details"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete card details?"
        description="The stored number, security code, name and postcode for this card will be removed. The card itself stays."
        confirmLabel="Delete details"
        variant="destructive"
        loading={submitting}
        onConfirm={handleDelete}
      />
    </>
  );
}
