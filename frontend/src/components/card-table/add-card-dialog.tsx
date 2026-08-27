"use client";

import { useCallback, useEffect, useId, useRef, useState, useMemo } from "react";
import type { CardTemplate, Profile, TemplateVersionSummary } from "@/types";
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
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { DatePicker } from "@/components/ui/date-picker";
import { getTemplates, getTemplateImageVariantUrl, getTemplateVersions, createCard } from "@/lib/api";
import { frequencyShort, resetTypeLabel } from "@/lib/benefit-utils";
import { formatCurrency, parseIntStrict, parseMoneyField } from "@/lib/utils";
import { toast } from "sonner";
import { format } from "date-fns";
import { Check } from "lucide-react";

interface AddCardDialogProps {
  profiles: Profile[];
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  defaultProfileId?: number;
}

/** "a profile", "a card name and an issuer", "a profile, a card name and an issuer" */
function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** "Julie_Mehretu.png" -> "Julie Mehretu", so the art options don't announce
 *  their filenames. */
function prettyImageName(filename: string): string {
  return filename.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim();
}

export function AddCardDialog({ profiles, open, onClose, onCreated, defaultProfileId }: AddCardDialogProps) {
  const [templates, setTemplates] = useState<CardTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState(false);
  const [templateSearch, setTemplateSearch] = useState("");
  const [issuerFilter, setIssuerFilter] = useState("all");
  const [showUnavailable, setShowUnavailable] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<string>("custom");
  const [profileId, setProfileId] = useState<string>(defaultProfileId?.toString() || "");
  const [cardName, setCardName] = useState("");
  const [lastDigits, setLastDigits] = useState("");
  const [issuer, setIssuer] = useState("");
  const [network, setNetwork] = useState("");
  const [cardType, setCardType] = useState("personal");
  const [openDate, setOpenDate] = useState<Date | undefined>();
  const [annualFee, setAnnualFee] = useState("");
  const [creditLimit, setCreditLimit] = useState("");
  const [spendReminderEnabled, setSpendReminderEnabled] = useState(false);
  const [spendRequirement, setSpendRequirement] = useState("");
  const [spendDeadline, setSpendDeadline] = useState<Date | undefined>();
  const [spendReminderNotes, setSpendReminderNotes] = useState("");
  const [signupBonusAmount, setSignupBonusAmount] = useState("");
  const [signupBonusType, setSignupBonusType] = useState("");
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [versions, setVersions] = useState<TemplateVersionSummary[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<string>("current");
  const [submitting, setSubmitting] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  // Ids are per-instance: Radix Label creates no implicit association and none
  // of these fields wrap their control, so without an explicit htmlFor/id pair
  // clicking a label focused nothing and every field announced unlabelled.
  const uid = useId();
  const fid = (name: string) => `${uid}-${name}`;

  // A ref, not `templates.length`: a catalogue that legitimately comes back
  // empty (CARD_TEMPLATES_DIR unset, or a build with no YAML) leaves the length
  // at 0 while `templatesLoading` flips back to false, which re-satisfies the
  // guard below and refetches forever. The ref latches on the request itself, so
  // it also survives StrictMode's double-invoked effect.
  const templatesRequestedRef = useRef(false);

  const loadTemplates = useCallback(() => {
    templatesRequestedRef.current = true;
    setTemplatesLoading(true);
    setTemplatesError(false);
    getTemplates()
      .then((t) => {
        setTemplates(t);
        setTemplatesLoading(false);
      })
      .catch(() => {
        setTemplatesError(true);
        setTemplatesLoading(false);
        toast.error("Failed to load card templates");
      });
  }, []);

  // Fetched once and kept: the catalogue is static for the life of the page, and
  // refetching on every open left the picker looking empty rather than loading.
  // A failure latches too — the Retry button below is the way back, so a backend
  // that is down doesn't get a fresh request every time the dialog reopens.
  useEffect(() => {
    if (!open) return;
    if (templatesRequestedRef.current) return;
    loadTemplates();
  }, [open, loadTemplates]);

  useEffect(() => {
    if (defaultProfileId) {
      setProfileId(defaultProfileId.toString());
      return;
    }
    // "All profiles" in the header leaves no default, which used to open the
    // dialog with the submit button already dead and nothing saying why. One
    // profile is unambiguous; more than one still has to be chosen.
    if (profiles.length === 1) {
      setProfileId((prev) => prev || profiles[0].id.toString());
    }
  }, [defaultProfileId, profiles]);

  const handleTemplateChange = (templateId: string) => {
    setSelectedTemplate(templateId);
    setSelectedImage(null);
    setVersions([]);
    setSelectedVersion("current");
    if (templateId === "custom") return;
    const tmpl = templates.find((t) => t.id === templateId);
    if (tmpl) {
      setCardName(tmpl.name);
      setIssuer(tmpl.issuer);
      setNetwork(tmpl.network || "");
      setAnnualFee(tmpl.annual_fee?.toString() || "0");
      setCardType(tmpl.tags?.includes("business") ? "business" : "personal");
      // Fetch versions
      const [issuer, cardName] = templateId.split("/");
      getTemplateVersions(issuer, cardName).then((v) => {
        setVersions(v);
      }).catch(() => {
        toast.error("Failed to load template versions");
      });
    }
  };

  const handleVersionChange = (versionId: string) => {
    setSelectedVersion(versionId);
    if (versionId === "current") {
      const tmpl = templates.find((t) => t.id === selectedTemplate);
      if (tmpl) {
        setAnnualFee(tmpl.annual_fee?.toString() || "0");
      }
    } else {
      const ver = versions.find((v) => v.version_id === versionId);
      if (ver) {
        setAnnualFee(ver.annual_fee?.toString() || "0");
      }
    }
  };

  const issuers = useMemo(
    () => [...new Set(templates.map((t) => t.issuer))].sort(),
    [templates],
  );

  const filteredTemplates = useMemo(
    () =>
      templates.filter((t) => {
        // Never filter out the current selection — otherwise picking a
        // discontinued card and then typing in the search box makes the chosen
        // template vanish from its own dropdown.
        if (t.id === selectedTemplate) return true;
        // Cards whose program has ended stay available behind a toggle rather
        // than being removed: this app tracks closed cards too, so backfilling
        // a card you held years ago is a legitimate reason to reach for a
        // template that nobody can apply for today.
        if (!showUnavailable && t.status !== "active") return false;
        if (issuerFilter !== "all" && t.issuer !== issuerFilter) return false;
        if (!templateSearch) return true;
        const q = templateSearch.toLowerCase();
        return t.name.toLowerCase().includes(q) || t.issuer.toLowerCase().includes(q);
      }),
    [templates, templateSearch, issuerFilter, showUnavailable, selectedTemplate],
  );

  const unavailableCount = useMemo(
    () => templates.filter((t) => t.status !== "active").length,
    [templates],
  );

  const formatDateStr = (d: Date | undefined) => d ? format(d, "yyyy-MM-dd") : null;

  const missingRequired = [
    !profileId && "a profile",
    !cardName.trim() && "a card name",
    !issuer.trim() && "an issuer",
  ].filter(Boolean) as string[];

  const handleSubmit = async () => {
    if (submitting) return;
    const parsedProfileId = parseIntStrict(profileId);
    if (!parsedProfileId || !cardName.trim() || !issuer.trim()) return;
    setSubmitting(true);
    try {
      const currentVer = versions.find((v) => v.is_current);
      const templateVersionId = selectedTemplate !== "custom" && selectedVersion !== "current" && selectedVersion !== currentVer?.version_id
        ? selectedVersion
        : null;
      // parseMoneyField, not parseIntStrict: the latter returns null for both an
      // empty field and "550.5", so a mistyped fee was created as "no fee" with
      // a success toast. It throws instead, and the catch below surfaces why.
      await createCard({
        profile_id: parsedProfileId,
        template_id: selectedTemplate === "custom" ? null : selectedTemplate,
        template_version_id: templateVersionId,
        card_image: selectedImage,
        card_name: cardName,
        last_digits: lastDigits || null,
        issuer,
        network: network || null,
        card_type: cardType,
        open_date: formatDateStr(openDate),
        annual_fee: parseMoneyField(annualFee, "Annual fee"),
        credit_limit: parseMoneyField(creditLimit, "Credit limit"),
        spend_reminder_enabled: spendReminderEnabled,
        spend_requirement: parseMoneyField(spendRequirement, "Spend requirement"),
        spend_deadline: formatDateStr(spendDeadline),
        spend_reminder_notes: spendReminderNotes || null,
        signup_bonus_amount: parseMoneyField(signupBonusAmount, "Signup bonus amount"),
        signup_bonus_type: signupBonusType || null,
      });
      resetForm();
      onCreated();
      onClose();
      toast.success(`${cardName} added`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add card");
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setTemplateSearch("");
    setIssuerFilter("all");
    setShowUnavailable(false);
    setSelectedTemplate("custom");
    setSelectedImage(null);
    setVersions([]);
    setSelectedVersion("current");
    setCardName("");
    setLastDigits("");
    setIssuer("");
    setNetwork("");
    setCardType("personal");
    setOpenDate(undefined);
    setAnnualFee("");
    setCreditLimit("");
    setSpendReminderEnabled(false);
    setSpendRequirement("");
    setSpendDeadline(undefined);
    setSpendReminderNotes("");
    setSignupBonusAmount("");
    setSignupBonusType("");
  };

  /**
   * Anything the user could lose. The browse controls (search box, issuer
   * filter, discontinued toggle) are deliberately excluded — they cost a second
   * to redo — and so is the profile, which the header usually prefills. Picking
   * a template counts, because it fills the name, issuer, network and fee.
   */
  const isDirty = () =>
    selectedTemplate !== "custom" ||
    selectedImage !== null ||
    selectedVersion !== "current" ||
    cardName.trim() !== "" ||
    lastDigits !== "" ||
    issuer.trim() !== "" ||
    network !== "" ||
    cardType !== "personal" ||
    openDate !== undefined ||
    annualFee !== "" ||
    creditLimit !== "" ||
    spendReminderEnabled ||
    spendRequirement !== "" ||
    spendDeadline !== undefined ||
    spendReminderNotes !== "" ||
    signupBonusAmount !== "" ||
    signupBonusType !== "";

  // The X, Esc and an overlay click all used to throw ~20 filled fields away
  // with no confirm and no undo. The Edit Card form already asks; so does this.
  const requestClose = () => {
    if (isDirty()) {
      setShowDiscardConfirm(true);
      return;
    }
    resetForm();
    onClose();
  };

  // Esc and outside-pointer dismissal are preventable; the header X is not, so
  // requestClose above covers that one by simply not calling onClose.
  const guardDismiss = (e: Event) => {
    if (!isDirty()) return;
    e.preventDefault();
    setShowDiscardConfirm(true);
  };

  const selectedTmpl = selectedTemplate === "custom"
    ? undefined
    : templates.find((t) => t.id === selectedTemplate);

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!v) requestClose(); }}>
        {/* The header used to scroll away with the body — and Radix's close X
            with it. Only the form scrolls now, as in the card-detail dialog. */}
        <DialogContent
          className="max-w-lg max-h-[90vh] overflow-hidden p-0 flex flex-col"
          onEscapeKeyDown={guardDismiss}
          onPointerDownOutside={guardDismiss}
        >
          <DialogHeader className="px-6 pt-6 pr-14 shrink-0">
            <DialogTitle>Add Card</DialogTitle>
            <DialogDescription>Add a new card from a template or create a custom entry.</DialogDescription>
          </DialogHeader>

          <form
            onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}
            className="space-y-3 overflow-y-auto scrollbar-thin px-6 pb-6 flex-1 min-h-0"
          >
            <div>
              <Label htmlFor={fid("profile")}>
                Profile <span aria-hidden="true" className="text-danger">*</span>
              </Label>
              <Select value={profileId} onValueChange={setProfileId}>
                <SelectTrigger id={fid("profile")}><SelectValue placeholder="Select profile" /></SelectTrigger>
                <SelectContent>
                  {profiles.map((p) => (
                    <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor={fid("template")}>Template</Label>
              <div className="grid grid-cols-[1fr_auto] gap-1.5 mb-1.5">
                <Input
                  id={fid("template-search")}
                  type="search"
                  aria-label="Search card templates"
                  placeholder="Search templates..."
                  value={templateSearch}
                  onChange={(e) => setTemplateSearch(e.target.value)}
                  autoComplete="off"
                  enterKeyHint="search"
                  // This box filters the list below; Enter here must not submit
                  // the whole form and create the card. Filtering is live, so
                  // Enter just dismisses the keyboard.
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      e.currentTarget.blur();
                    }
                  }}
                />
                <Select value={issuerFilter} onValueChange={setIssuerFilter}>
                  <SelectTrigger
                    className="w-[130px]"
                    aria-label="Filter templates by issuer"
                    title={issuerFilter === "all" ? "All Issuers" : issuerFilter}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Issuers</SelectItem>
                    {issuers.map((iss) => (
                      <SelectItem key={iss} value={iss} title={iss}>{iss}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Select value={selectedTemplate} onValueChange={handleTemplateChange}>
                <SelectTrigger id={fid("template")}><SelectValue placeholder="Select template" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="custom">Custom Card</SelectItem>
                  {filteredTemplates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} ({t.issuer})
                      {t.status !== "active" && (
                        <span className="ml-1.5 text-xs text-muted-foreground">
                          {t.status === "discontinued" ? "· discontinued" : "· closed to new"}
                        </span>
                      )}
                    </SelectItem>
                  ))}
                  {/* Otherwise the list silently collapses to "Custom Card" and
                      nothing points at the toggle that would bring cards back. */}
                  {templatesLoading && filteredTemplates.length === 0 && (
                    <div className="px-2 py-3 text-xs text-muted-foreground">Loading templates…</div>
                  )}
                  {!templatesLoading && filteredTemplates.length === 0 && (
                    <div className="px-2 py-3 text-xs text-muted-foreground">
                      {templatesError
                        ? "Templates couldn't be loaded — retry below."
                        : templates.length === 0
                        ? "No templates available."
                        : !showUnavailable && unavailableCount > 0
                        ? "No matching templates. Discontinued and closed cards are hidden — use the toggle below."
                        : "No matching templates."}
                    </div>
                  )}
                </SelectContent>
              </Select>
              {templatesError && (
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <p className="text-xs text-danger">Couldn&apos;t load card templates.</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={loadTemplates}
                    disabled={templatesLoading}
                  >
                    {templatesLoading ? "Retrying…" : "Retry"}
                  </Button>
                </div>
              )}
              {unavailableCount > 0 && (
                <button
                  type="button"
                  onClick={() => setShowUnavailable((v) => !v)}
                  className="mt-1.5 inline-flex items-center min-h-[44px] sm:min-h-0 rounded px-1 -mx-1 text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {showUnavailable
                    ? "Hide discontinued cards"
                    : `Show ${unavailableCount} discontinued or closed card${unavailableCount === 1 ? "" : "s"}`}
                </button>
              )}
            </div>

            {/* Version picker */}
            {selectedTemplate !== "custom" && versions.length > 1 && (
              <div>
                <Label htmlFor={fid("version")}>Version</Label>
                <Select value={selectedVersion} onValueChange={handleVersionChange}>
                  <SelectTrigger id={fid("version")}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {versions.map((v) => (
                      <SelectItem key={v.version_id} value={v.is_current ? "current" : v.version_id}>
                        {v.is_current ? "Current" : v.name} — {formatCurrency(v.annual_fee ?? 0)}/yr
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {(() => {
              const credits = selectedTmpl?.benefits?.credits;
              const thresholds = selectedTmpl?.benefits?.spend_thresholds;
              const hasCredits = credits && credits.length > 0;
              const hasThresholds = thresholds && thresholds.length > 0;
              if (!hasCredits && !hasThresholds) return null;
              return (
                // Capped and scrollable: amex/platinum ships 12 credits, which
                // pushed Card Name, Issuer, Open Date and the submit button
                // ~270px down inside an already-scrolling dialog.
                <div className="rounded-lg border bg-muted/20 p-3 space-y-1 max-h-40 overflow-y-auto scrollbar-thin">
                  {hasCredits && (
                    <>
                      <p className="text-xs font-medium text-muted-foreground">Credits that will be auto-created:</p>
                      {credits.map((c, i) => (
                        <div key={i} className="flex items-start justify-between gap-2 text-sm">
                          <span className="min-w-0 break-words">{c.name}</span>
                          <span className="text-muted-foreground text-xs shrink-0">
                            {formatCurrency(c.amount)}{frequencyShort(c.frequency)} ({resetTypeLabel(c.reset_type)})
                          </span>
                        </div>
                      ))}
                    </>
                  )}
                  {hasThresholds && (
                    <>
                      <p className="text-xs font-medium text-muted-foreground mt-2">Spend thresholds that will be tracked:</p>
                      {thresholds.map((t, i) => (
                        <div key={i} className="flex items-start justify-between gap-2 text-sm">
                          <span className="min-w-0 break-words">{t.name}</span>
                          <span className="text-muted-foreground text-xs shrink-0">
                            {formatCurrency(t.spend_required)}{frequencyShort(t.frequency)} ({resetTypeLabel(t.reset_type)})
                          </span>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              );
            })()}

            {/* Image picker */}
            {selectedTmpl && selectedTmpl.images.length > 1 && (
              <div className="space-y-1.5">
                {/* role=group + aria-pressed, because selection was carried by a
                    border alone and each option announced its filename. */}
                <Label className="text-xs text-muted-foreground" id={fid("art-label")}>Card Art</Label>
                <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-labelledby={fid("art-label")}>
                  {selectedTmpl.images.map((filename, i) => {
                    const selected = selectedImage === filename || (selectedImage === null && i === 0);
                    return (
                      <button
                        key={filename}
                        type="button"
                        aria-pressed={selected}
                        aria-label={i === 0 ? "Default card art" : `Card art: ${prettyImageName(filename)}`}
                        onClick={() => setSelectedImage(i === 0 ? null : filename)}
                        className={`relative shrink-0 rounded-md overflow-hidden border-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          selected
                            ? "border-primary ring-2 ring-primary/20"
                            : "border-transparent hover:border-muted-foreground/30"
                        }`}
                      >
                        <img
                          src={getTemplateImageVariantUrl(selectedTmpl.id, filename)}
                          alt=""
                          className="w-20 h-[50px] object-cover"
                        />
                        {selected && (
                          <span className="absolute right-1 top-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                            <Check className="h-3 w-3" />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-3">
              <div>
                <Label htmlFor={fid("card-name")}>
                  Card Name <span aria-hidden="true" className="text-danger">*</span>
                </Label>
                <Input
                  id={fid("card-name")}
                  required
                  enterKeyHint="next"
                  value={cardName}
                  onChange={(e) => setCardName(e.target.value)}
                  maxLength={100}
                />
              </div>
              <div>
                <Label htmlFor={fid("last-digits")}>Last 4/5</Label>
                {/* Digits-only field: without inputMode the QWERTY keyboard came
                    up and every typed letter silently disappeared. */}
                <Input
                  id={fid("last-digits")}
                  value={lastDigits}
                  onChange={(e) => setLastDigits(e.target.value.replace(/\D/g, "").slice(0, 5))}
                  inputMode="numeric"
                  autoComplete="off"
                  enterKeyHint="next"
                  placeholder="1234"
                  className="w-[72px] font-mono tabular-nums"
                />
              </div>
              <div>
                <Label htmlFor={fid("issuer")}>
                  Issuer <span aria-hidden="true" className="text-danger">*</span>
                </Label>
                <Input
                  id={fid("issuer")}
                  required
                  enterKeyHint="next"
                  value={issuer}
                  onChange={(e) => setIssuer(e.target.value)}
                  maxLength={100}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label htmlFor={fid("network")}>Network</Label>
                <Input
                  id={fid("network")}
                  enterKeyHint="next"
                  value={network}
                  onChange={(e) => setNetwork(e.target.value)}
                  placeholder="Visa"
                  maxLength={50}
                />
              </div>
              <div>
                <Label htmlFor={fid("type")}>Type</Label>
                <Select value={cardType} onValueChange={setCardType}>
                  <SelectTrigger id={fid("type")}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="personal">Personal</SelectItem>
                    <SelectItem value="business">Business</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div role="group" aria-labelledby={fid("open-date-label")}>
                {/* DatePicker exposes no id, so the label names the wrapping
                    group instead of the trigger — the same shape the Edit Card
                    form uses (card-detail-content.tsx:1606). An id alone would
                    have left the trigger announcing "Select date, button". */}
                <Label id={fid("open-date-label")}>Open Date</Label>
                <DatePicker value={openDate} onChange={setOpenDate} placeholder="Select date" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor={fid("annual-fee")}>Annual Fee</Label>
                <Input
                  id={fid("annual-fee")}
                  type="number"
                  min="0"
                  inputMode="numeric"
                  enterKeyHint="next"
                  value={annualFee}
                  onChange={(e) => setAnnualFee(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div>
                <Label htmlFor={fid("credit-limit")}>Credit Limit</Label>
                <Input
                  id={fid("credit-limit")}
                  type="number"
                  min="1"
                  inputMode="numeric"
                  enterKeyHint="next"
                  value={creditLimit}
                  onChange={(e) => setCreditLimit(e.target.value)}
                />
              </div>
            </div>

            <div className="border rounded-xl p-3 space-y-3">
              <div className="flex items-center justify-between">
                <h4 id={fid("spend-reminder-label")} className="font-medium text-sm">Spend Reminder</h4>
                <Switch
                  id={fid("spend-reminder")}
                  aria-labelledby={fid("spend-reminder-label")}
                  checked={spendReminderEnabled}
                  onCheckedChange={setSpendReminderEnabled}
                />
              </div>
              {spendReminderEnabled && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor={fid("spend-req")}>Spend Requirement ($)</Label>
                      <Input
                        id={fid("spend-req")}
                        type="number"
                        inputMode="numeric"
                        enterKeyHint="next"
                        value={spendRequirement}
                        onChange={(e) => setSpendRequirement(e.target.value)}
                        placeholder="4000"
                      />
                    </div>
                    <div role="group" aria-labelledby={fid("spend-deadline-label")}>
                      <Label id={fid("spend-deadline-label")}>Deadline</Label>
                      <DatePicker value={spendDeadline} onChange={setSpendDeadline} placeholder="Select date" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor={fid("sba")}>Signup Bonus Amount</Label>
                      <Input
                        id={fid("sba")}
                        type="number"
                        inputMode="numeric"
                        enterKeyHint="next"
                        value={signupBonusAmount}
                        onChange={(e) => setSignupBonusAmount(e.target.value)}
                        placeholder="60000"
                      />
                    </div>
                    <div>
                      <Label htmlFor={fid("sbt")}>Bonus Type</Label>
                      <Input
                        id={fid("sbt")}
                        enterKeyHint="next"
                        value={signupBonusType}
                        onChange={(e) => setSignupBonusType(e.target.value)}
                        placeholder="e.g. Ultimate Rewards"
                        maxLength={100}
                      />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor={fid("notes")}>Notes</Label>
                    <Input
                      id={fid("notes")}
                      enterKeyHint="done"
                      value={spendReminderNotes}
                      onChange={(e) => setSpendReminderNotes(e.target.value)}
                      placeholder="e.g. Need to hit $4k in 3 months"
                      maxLength={1000}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Button
                type="submit"
                className="w-full"
                disabled={submitting || missingRequired.length > 0}
                aria-describedby={fid("submit-hint")}
              >
                {submitting ? "Adding..." : "Add Card"}
              </Button>
              {/* The button used to sit dead from the moment the dialog opened
                  with nothing naming the blocker. Always mounted, because a live
                  region that appears at the same moment as its text doesn't
                  reliably announce. */}
              <p id={fid("submit-hint")} aria-live="polite" className="text-xs text-muted-foreground text-center">
                {missingRequired.length > 0 ? `Add ${joinList(missingRequired)} to continue.` : ""}
              </p>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={showDiscardConfirm}
        onOpenChange={setShowDiscardConfirm}
        title="Discard Card?"
        description="This form has details you haven't saved. Discard them?"
        confirmLabel="Discard"
        variant="destructive"
        onConfirm={() => { setShowDiscardConfirm(false); resetForm(); onClose(); }}
      />
    </>
  );
}
