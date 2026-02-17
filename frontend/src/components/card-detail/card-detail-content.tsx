"use client";

import { useEffect, useState, useMemo } from "react";
import type { Card, CardEvent, CardTemplate } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { closeCard, reopenCard, createCardEvent, getTemplates, getTemplateImageUrl, getTemplateImageVariantUrl, PLACEHOLDER_IMAGE_URL, productChange, updateCard, updateEvent, updateBonus, deleteBonus, deleteCard, restoreCard } from "@/lib/api";
import { frequencyShort } from "@/lib/benefit-utils";
import { formatDate, formatCurrency, parseIntStrict, parseDateStr } from "@/lib/utils";
import { useToday } from "@/hooks/use-timezone";
import { getNextFeeInfo } from "@/lib/fee-utils";
import { AnnualFeeHistorySection } from "@/components/card-detail/annual-fee-history-section";
import { BenefitsSection } from "@/components/card-detail/benefits-section";
import { RetentionHistorySection } from "@/components/card-detail/retention-history-section";
import { useCardSections } from "@/hooks/use-card-sections";
import { toast } from "sonner";
import { format } from "date-fns";
import { useColorExtraction } from "@/hooks/use-color-extraction";
import { getEventMeta } from "@/lib/event-icons";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Check,
  Clock,
  Calendar,
  DollarSign,
  CalendarClock,
  Landmark,
  FileText,
  Ban,
  ArrowLeftRight,
  PlusCircle,
  ArrowRight,
  X,
  Pencil,
  RefreshCw,
  ChevronDown,
  Trophy,
  Trash2,
} from "lucide-react";

interface CardDetailContentProps {
  card: Card;
  onUpdated: () => void;
  onDeleted?: () => void;
  profileName?: string;
}

export function CardDetailContent({ card, onUpdated, onDeleted, profileName }: CardDetailContentProps) {
  const { isExpanded, toggle, expand } = useCardSections(card.id);
  const today = useToday();
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [card.template_id, card.card_image, card.id]);

  const [showCloseForm, setShowCloseForm] = useState(false);
  const [closeDate, setCloseDate] = useState<Date | undefined>();
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [showEventForm, setShowEventForm] = useState(false);
  const [eventType, setEventType] = useState("other");
  const [eventDate, setEventDate] = useState<Date | undefined>();
  const [eventDesc, setEventDesc] = useState("");
  const [eventFee, setEventFee] = useState("");
  const [showPCForm, setShowPCForm] = useState(false);
  const [pcName, setPcName] = useState("");
  const [pcTemplates, setPcTemplates] = useState<CardTemplate[]>([]);
  const [pcSelectedTemplate, setPcSelectedTemplate] = useState("custom");
  const [pcIssuerFilter, setPcIssuerFilter] = useState("__current__");
  const [pcAnnualFee, setPcAnnualFee] = useState("");
  const [pcNetwork, setPcNetwork] = useState("");
  const [pcDate, setPcDate] = useState<Date | undefined>();
  const [pcSyncBenefits, setPcSyncBenefits] = useState(true);
  const [pcUpgradeBonus, setPcUpgradeBonus] = useState(false);
  const [pcUpgradeBonusAmount, setPcUpgradeBonusAmount] = useState("");
  const [pcUpgradeBonusType, setPcUpgradeBonusType] = useState("");
  const [pcUpgradeSpendReq, setPcUpgradeSpendReq] = useState("");
  const [pcUpgradeSpendDeadline, setPcUpgradeSpendDeadline] = useState<Date | undefined>();
  const [pcUpgradeSpendNotes, setPcUpgradeSpendNotes] = useState("");
  const [pcResetAfAnniversary, setPcResetAfAnniversary] = useState(true);
  const [pcSelectedImage, setPcSelectedImage] = useState<string | null>(null);
  const [editTemplates, setEditTemplates] = useState<CardTemplate[]>([]);
  const [editingLastDigits, setEditingLastDigits] = useState(false);
  const [lastDigitsValue, setLastDigitsValue] = useState(card.last_digits || "");
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState(card.custom_notes || "");
  const [editingEventId, setEditingEventId] = useState<number | null>(null);
  const [editEventDesc, setEditEventDesc] = useState("");
  const [editEventDate, setEditEventDate] = useState<Date | undefined>();
  const [editEventType, setEditEventType] = useState("");
  const [editEventFee, setEditEventFee] = useState("");
  const [showEditForm, setShowEditForm] = useState(false);
  const [ef, setEf] = useState({
    card_name: "",
    issuer: "",
    network: "",
    card_type: "personal" as string,
    open_date: undefined as Date | undefined,
    annual_fee: "",
    annual_fee_date: undefined as Date | undefined,
    credit_limit: "",
    custom_tags: "",
    signup_bonus_amount: "",
    signup_bonus_type: "",
    spend_requirement: "",
    spend_deadline: undefined as Date | undefined,
    spend_reminder_notes: "",
    card_image: null as string | null,
  });
  const updateEf = <K extends keyof typeof ef>(k: K, v: (typeof ef)[K]) =>
    setEf((p) => ({ ...p, [k]: v }));
  const isEditFormDirty = () => {
    if (!showEditForm) return false;
    const fmtDate = (d: Date | undefined) => d ? format(d, "yyyy-MM-dd") : "";
    return (
      ef.card_name !== card.card_name ||
      ef.issuer !== card.issuer ||
      (ef.network || "") !== (card.network || "") ||
      ef.card_type !== card.card_type ||
      fmtDate(ef.open_date) !== (card.open_date || "") ||
      ef.annual_fee !== (card.annual_fee != null ? String(card.annual_fee) : "") ||
      fmtDate(ef.annual_fee_date) !== (card.annual_fee_date || "") ||
      ef.credit_limit !== (card.credit_limit != null ? String(card.credit_limit) : "") ||
      ef.custom_tags !== (card.custom_tags || []).join(", ") ||
      ef.signup_bonus_amount !== (card.signup_bonus_amount != null ? String(card.signup_bonus_amount) : "") ||
      ef.signup_bonus_type !== (card.signup_bonus_type || "") ||
      ef.spend_requirement !== (card.spend_requirement != null ? String(card.spend_requirement) : "") ||
      fmtDate(ef.spend_deadline) !== (card.spend_deadline || "") ||
      ef.spend_reminder_notes !== (card.spend_reminder_notes || "") ||
      ef.card_image !== (card.card_image || null)
    );
  };
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const tryCloseEditForm = () => {
    if (isEditFormDirty()) {
      setShowDiscardConfirm(true);
    } else {
      setShowEditForm(false);
    }
  };
  const [submittingAction, setSubmittingAction] = useState<string | null>(null);

  // Fetch templates when PC form opens
  useEffect(() => {
    if (showPCForm) {
      getTemplates().then(setPcTemplates).catch(() => toast.error("Failed to load templates"));
      setPcIssuerFilter("__current__");
      setPcSelectedTemplate("custom");
      setPcAnnualFee("");
      setPcNetwork("");
      setPcName("");
    }
  }, [showPCForm]);

  // Fetch templates when edit form opens (for image picker)
  useEffect(() => {
    if (showEditForm && card.template_id) {
      getTemplates().then(setEditTemplates).catch(() => {});
    }
  }, [showEditForm, card.template_id]);

  const pcIssuers = useMemo(
    () => [...new Set(pcTemplates.map((t) => t.issuer))].sort(),
    [pcTemplates],
  );
  const pcFilteredTemplates = useMemo(
    () =>
      pcTemplates.filter((t) => {
        if (t.id === card.template_id) return false;
        if (pcIssuerFilter === "__all__") return true;
        if (pcIssuerFilter === "__current__")
          return t.issuer.toLowerCase() === card.issuer.toLowerCase();
        return t.issuer === pcIssuerFilter;
      }),
    [pcTemplates, pcIssuerFilter, card.template_id, card.issuer],
  );

  const handlePcTemplateChange = (templateId: string) => {
    setPcSelectedTemplate(templateId);
    setPcSelectedImage(null);
    if (templateId === "custom") {
      setPcAnnualFee("");
      setPcNetwork("");
      return;
    }
    const tmpl = pcTemplates.find((t) => t.id === templateId);
    if (tmpl) {
      setPcName(tmpl.name);
      setPcAnnualFee(tmpl.annual_fee?.toString() || "0");
      setPcNetwork(tmpl.network || "");
    }
  };

  const imageUrl = card.template_id
    ? (card.card_image
      ? getTemplateImageVariantUrl(card.template_id, card.card_image)
      : getTemplateImageUrl(card.template_id))
    : PLACEHOLDER_IMAGE_URL;
  const accentColor = useColorExtraction(imageUrl);
  const accentTint = `color-mix(in srgb, ${accentColor} 15%, transparent)`;
  const accentBorder = `color-mix(in srgb, ${accentColor} 30%, transparent)`;

  const handleClose = async () => {
    if (!closeDate) return;
    setSubmittingAction("close");
    try {
      await closeCard(card.id, format(closeDate, "yyyy-MM-dd"));
      setShowCloseForm(false);
      setCloseDate(undefined);
      onUpdated();
      toast.success("Card closed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to close card");
    } finally {
      setSubmittingAction(null);
    }
  };

  const handleAddEvent = async () => {
    if (!eventDate) return;
    setSubmittingAction("event");
    try {
      const isAF = eventType === "annual_fee_posted" || eventType === "annual_fee_refund";
      await createCardEvent(card.id, {
        event_type: eventType,
        event_date: format(eventDate, "yyyy-MM-dd"),
        description: isAF ? (eventDesc || null) : (eventDesc || null),
        ...(isAF && eventFee ? { metadata_json: { annual_fee: parseIntStrict(eventFee) } } : {}),
      });
      setShowEventForm(false);
      setEventType("other");
      setEventDate(undefined);
      setEventDesc("");
      setEventFee("");
      onUpdated();
      toast.success("Event added");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add event");
    } finally {
      setSubmittingAction(null);
    }
  };

  const handleProductChange = async () => {
    if (!pcName || !pcDate) return;
    setSubmittingAction("productChange");
    try {
      const templateId = pcSelectedTemplate === "custom" ? null : pcSelectedTemplate;
      const annualFee = pcAnnualFee ? (parseIntStrict(pcAnnualFee) ?? undefined) : undefined;
      const network = pcNetwork || undefined;
      const upgradeBonusData = pcUpgradeBonus && pcUpgradeBonusAmount
        ? {
            amount: parseIntStrict(pcUpgradeBonusAmount) ?? 0,
            type: pcUpgradeBonusType || undefined,
            spendRequirement: pcUpgradeSpendReq ? (parseIntStrict(pcUpgradeSpendReq) ?? undefined) : undefined,
            spendDeadline: pcUpgradeSpendDeadline ? format(pcUpgradeSpendDeadline, "yyyy-MM-dd") : undefined,
            spendReminderNotes: pcUpgradeSpendNotes || undefined,
          }
        : undefined;
      await productChange(card.id, {
        new_template_id: templateId,
        new_card_name: pcName,
        change_date: format(pcDate, "yyyy-MM-dd"),
        new_annual_fee: annualFee,
        sync_benefits: pcSyncBenefits,
        new_network: network,
        new_card_image: pcSelectedImage,
        ...(upgradeBonusData ? {
          upgrade_bonus_amount: upgradeBonusData.amount,
          upgrade_bonus_type: upgradeBonusData.type,
          upgrade_spend_requirement: upgradeBonusData.spendRequirement,
          upgrade_spend_deadline: upgradeBonusData.spendDeadline,
          upgrade_spend_reminder_notes: upgradeBonusData.spendReminderNotes,
        } : {}),
        reset_af_anniversary: pcResetAfAnniversary,
      });
      setShowPCForm(false);
      setPcName("");
      setPcSelectedTemplate("custom");
      setPcDate(undefined);
      setPcSyncBenefits(true);
      setPcResetAfAnniversary(true);
      setPcAnnualFee("");
      setPcNetwork("");
      setPcTemplates([]);
      setPcSelectedImage(null);
      setPcUpgradeBonus(false);
      setPcUpgradeBonusAmount("");
      setPcUpgradeBonusType("");
      setPcUpgradeSpendReq("");
      setPcUpgradeSpendDeadline(undefined);
      setPcUpgradeSpendNotes("");
      onUpdated();
      toast.success("Product change completed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to process product change");
    } finally {
      setSubmittingAction(null);
    }
  };

  const startEditEvent = (event: CardEvent) => {
    setEditingEventId(event.id);
    setEditEventDesc(event.description ?? "");
    setEditEventDate(event.event_date ? parseDateStr(event.event_date) : undefined);
    setEditEventType(event.event_type);
    if ((event.event_type === "annual_fee_posted" || event.event_type === "annual_fee_refund") && event.metadata_json) {
      const fee = (event.metadata_json as Record<string, unknown>).annual_fee;
      setEditEventFee(fee != null ? String(fee) : "");
    } else {
      setEditEventFee("");
    }
  };

  const cancelEditEvent = () => {
    setEditingEventId(null);
    setEditEventDesc("");
    setEditEventDate(undefined);
    setEditEventType("");
    setEditEventFee("");
  };

  const handleEditEvent = async () => {
    if (editingEventId === null || !editEventDate) return;
    setSubmittingAction("editEvent");
    try {
      if (editEventType === "annual_fee_posted" || editEventType === "annual_fee_refund") {
        const editingEvent = card.events.find((e) => e.id === editingEventId);
        const existingMeta = (editingEvent?.metadata_json as Record<string, unknown>) || {};
        const { approximate_date: _, ...cleanMeta } = existingMeta;
        await updateEvent(editingEventId, {
          event_date: format(editEventDate, "yyyy-MM-dd"),
          description: editEventDesc || null,
          metadata_json: { ...cleanMeta, annual_fee: editEventFee ? parseIntStrict(editEventFee) : null },
        });
      } else {
        await updateEvent(editingEventId, {
          event_type: editEventType,
          event_date: format(editEventDate, "yyyy-MM-dd"),
          description: editEventDesc || null,
        });
      }
      cancelEditEvent();
      onUpdated();
      toast.success("Event updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update event");
    } finally {
      setSubmittingAction(null);
    }
  };

  const openEditForm = () => {
    setEf({
      card_name: card.card_name,
      issuer: card.issuer,
      network: card.network || "",
      card_type: card.card_type,
      open_date: card.open_date ? parseDateStr(card.open_date) : undefined,
      annual_fee: card.annual_fee != null ? String(card.annual_fee) : "",
      annual_fee_date: card.annual_fee_date ? parseDateStr(card.annual_fee_date) : undefined,
      credit_limit: card.credit_limit != null ? String(card.credit_limit) : "",
      custom_tags: (card.custom_tags || []).join(", "),
      signup_bonus_amount: card.signup_bonus_amount != null ? String(card.signup_bonus_amount) : "",
      signup_bonus_type: card.signup_bonus_type || "",
      spend_requirement: card.spend_requirement != null ? String(card.spend_requirement) : "",
      spend_deadline: card.spend_deadline ? parseDateStr(card.spend_deadline) : undefined,
      spend_reminder_notes: card.spend_reminder_notes || "",
      card_image: card.card_image || null,
    });
    setShowEditForm(true);
  };

  const handleSaveEdit = async () => {
    setSubmittingAction("edit");
    try {
      const updates: Record<string, unknown> = {};
      if (ef.card_name !== card.card_name) updates.card_name = ef.card_name;
      if (ef.issuer !== card.issuer) updates.issuer = ef.issuer;
      if ((ef.network || null) !== card.network) updates.network = ef.network || null;
      if (ef.card_type !== card.card_type) updates.card_type = ef.card_type;

      const newOpenDate = ef.open_date ? format(ef.open_date, "yyyy-MM-dd") : null;
      if (newOpenDate !== card.open_date) updates.open_date = newOpenDate;

      const newAF = ef.annual_fee ? parseIntStrict(ef.annual_fee) : null;
      if (newAF !== card.annual_fee) updates.annual_fee = newAF;

      const newAFDate = ef.annual_fee_date ? format(ef.annual_fee_date, "yyyy-MM-dd") : null;
      if (newAFDate !== card.annual_fee_date) updates.annual_fee_date = newAFDate;

      const newCL = ef.credit_limit ? parseIntStrict(ef.credit_limit) : null;
      if (newCL !== card.credit_limit) updates.credit_limit = newCL;

      const newTags = ef.custom_tags.split(",").map((t) => t.trim()).filter(Boolean);
      const oldTags = card.custom_tags || [];
      if (JSON.stringify(newTags) !== JSON.stringify(oldTags))
        updates.custom_tags = newTags.length > 0 ? newTags : null;

      const newSBA = ef.signup_bonus_amount ? parseIntStrict(ef.signup_bonus_amount) : null;
      if (newSBA !== card.signup_bonus_amount) updates.signup_bonus_amount = newSBA;
      const newSBT = ef.signup_bonus_type || null;
      if (newSBT !== card.signup_bonus_type) updates.signup_bonus_type = newSBT;

      const newSR = ef.spend_requirement ? parseIntStrict(ef.spend_requirement) : null;
      if (newSR !== card.spend_requirement) updates.spend_requirement = newSR;
      const newSD = ef.spend_deadline ? format(ef.spend_deadline, "yyyy-MM-dd") : null;
      if (newSD !== card.spend_deadline) updates.spend_deadline = newSD;
      const newSRN = ef.spend_reminder_notes || null;
      if (newSRN !== card.spend_reminder_notes) updates.spend_reminder_notes = newSRN;

      if (ef.card_image !== (card.card_image || null)) updates.card_image = ef.card_image;

      if (Object.keys(updates).length > 0) {
        await updateCard(card.id, updates);
      }
      setShowEditForm(false);
      onUpdated();
      toast.success("Card updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save changes");
    } finally {
      setSubmittingAction(null);
    }
  };

  const sortedEvents = [...card.events]
    .filter((e) => e.event_type !== "retention_offer")
    .sort(
      (a, b) => new Date(b.event_date).getTime() - new Date(a.event_date).getTime()
    );

  const isDeadlineApproaching = () => {
    if (!card.spend_reminder_enabled || !card.spend_deadline) return false;
    const deadline = parseDateStr(card.spend_deadline);
    const daysLeft = Math.ceil((deadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return daysLeft <= 30 && daysLeft >= 0;
  };

  const isDeadlinePassed = () => {
    if (!card.spend_reminder_enabled || !card.spend_deadline) return false;
    const deadline = parseDateStr(card.spend_deadline);
    return today > deadline;
  };

  return (
    <div className="space-y-5">
      {/* Section 1 — Hero Image */}
      {!imgError && (
        <div className="-mx-6 -mt-6">
          <div className="relative">
            <img
              src={imageUrl}
              alt={card.card_name}
              className="w-full object-cover aspect-[1.586/1] max-h-[180px] sm:max-h-[240px]"
              onError={(e) => {
                const target = e.currentTarget;
                if (target.src !== PLACEHOLDER_IMAGE_URL) {
                  target.src = PLACEHOLDER_IMAGE_URL;
                } else {
                  setImgError(true);
                }
              }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-6">
              <h2 className="text-lg sm:text-xl font-semibold text-white mb-1.5">
                {card.card_name}
                {card.last_digits && <span className="font-normal text-white/60"> ••• {card.last_digits}</span>}
              </h2>
              <div className="flex items-center gap-2 mb-2">
                <p className="text-sm text-white/70">
                  {card.issuer}
                  {profileName && <span className="text-white/40"> &middot; {profileName}</span>}
                </p>
                {editingLastDigits ? (
                  <input
                    autoFocus
                    value={lastDigitsValue}
                    onChange={(e) => setLastDigitsValue(e.target.value.replace(/\D/g, "").slice(0, 5))}
                    onBlur={async () => {
                      const val = lastDigitsValue || null;
                      if (val !== card.last_digits) {
                        try {
                          await updateCard(card.id, { last_digits: val });
                          onUpdated();
                          toast.success("Last digits updated");
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Failed to update last digits");
                        }
                      }
                      setEditingLastDigits(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      if (e.key === "Escape") { setLastDigitsValue(card.last_digits || ""); setEditingLastDigits(false); }
                    }}
                    placeholder="Last digits"
                    className="bg-white/20 text-white text-xs rounded px-1.5 py-0.5 w-[72px] outline-none placeholder:text-white/40"
                  />
                ) : (
                  <button
                    onClick={() => { setLastDigitsValue(card.last_digits || ""); setEditingLastDigits(true); }}
                    className="text-xs text-white/40 hover:text-white/70 transition-colors"
                    aria-label="Edit last digits"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <Badge variant={card.status === "active" ? "success" : "secondary"} className="text-xs">
                  {card.status}
                </Badge>
                <Badge className="text-xs bg-white/20 text-white border-white/20 hover:bg-white/30">
                  {card.card_type}
                </Badge>
                {card.network && (
                  <Badge className="text-xs bg-white/20 text-white border-white/20 hover:bg-white/30">
                    {card.network}
                  </Badge>
                )}
              </div>
            </div>
          </div>
          <div className="h-1" style={{ background: `linear-gradient(to right, ${accentColor}, transparent)` }} />
        </div>
      )}

      {/* Fallback header when image fails */}
      {imgError && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-semibold">
              {card.card_name}
              {card.last_digits && <span className="text-muted-foreground font-normal"> ••• {card.last_digits}</span>}
            </h2>
            <Badge variant={card.status === "active" ? "success" : "secondary"}>
              {card.status}
            </Badge>
            <Badge variant="outline">{card.card_type}</Badge>
            {card.network && <Badge variant="outline">{card.network}</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">{card.issuer}</p>
        </div>
      )}

      {/* Section 2 — Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {(() => {
          const nextFeeInfo = getNextFeeInfo(card.open_date, card.annual_fee, card.status, card.annual_fee_date, today);
          const feeValueClass = nextFeeInfo?.proximity === "imminent"
            ? "text-orange-600 dark:text-orange-400"
            : nextFeeInfo?.proximity === "soon"
            ? "text-yellow-600 dark:text-yellow-400"
            : undefined;
          return [
            { icon: Calendar, label: "Opened", value: formatDate(card.open_date) },
            { icon: Calendar, label: "Closed", value: formatDate(card.close_date) },
            { icon: DollarSign, label: "Annual Fee", value: formatCurrency(card.annual_fee) },
            { icon: CalendarClock, label: "Next Fee", value: nextFeeInfo?.label ?? "\u2014", valueClass: feeValueClass },
            { icon: Landmark, label: "Credit Limit", value: card.credit_limit ? formatCurrency(card.credit_limit) : "\u2014" },
            { icon: FileText, label: "Template", value: card.template_id || "Custom" },
          ] as { icon: typeof Calendar; label: string; value: string; valueClass?: string }[];
        })().map(({ icon: Icon, label, value, valueClass }) => (
          <div
            key={label}
            className="rounded-lg border p-3"
            style={{ borderColor: accentBorder }}
          >
            <div className="flex items-center gap-1.5 mb-1">
              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">{label}</span>
            </div>
            <p className={`text-sm font-medium truncate ${valueClass ?? ""}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Section 2.5 — Annual Fee History */}
      <AnnualFeeHistorySection card={card} accentTint={accentTint} onUpdated={onUpdated} expanded={isExpanded("af")} onToggleExpand={() => toggle("af")} onExpand={() => expand("af")} />

      {/* Section 2.5b — Benefits & Credits */}
      <BenefitsSection card={card} accentTint={accentTint} onUpdated={onUpdated} expanded={isExpanded("benefits")} onToggleExpand={() => toggle("benefits")} onExpand={() => expand("benefits")} />

      {/* Section 2.5c — Retention History */}
      <RetentionHistorySection card={card} accentTint={accentTint} onUpdated={onUpdated} expanded={isExpanded("retention")} onToggleExpand={() => toggle("retention")} onExpand={() => expand("retention")} />

      {/* Section 3 — Bonus History (signup + upgrade/retention) */}
      {(() => {
        const visibleBonuses = card.bonuses?.filter(b => b.bonus_earned || b.bonus_missed || b.spend_reminder_enabled) ?? [];
        const hasSignupBonus = !!card.signup_bonus_amount || card.spend_reminder_enabled;
        if (visibleBonuses.length === 0 && !hasSignupBonus) return null;
        const totalCount = visibleBonuses.length + (hasSignupBonus ? 1 : 0);
        return (
        <div className="space-y-3">
          <div className="h-px" style={{ backgroundColor: accentTint }} />
          <div className="flex items-center justify-between">
            <button onClick={() => toggle("bonuses")} aria-expanded={isExpanded("bonuses")} className="flex items-center gap-2">
              <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${!isExpanded("bonuses") ? "-rotate-90" : ""}`} />
              <Trophy className="h-4 w-4 text-muted-foreground" />
              <h4 className="font-medium text-sm">Bonus History</h4>
              <Badge variant="secondary" className="text-xs">{totalCount}</Badge>
            </button>
          </div>
          {isExpanded("bonuses") && <>
          {/* Signup bonus */}
          {hasSignupBonus && (() => {
            // State A: Active spend tracking
            if (card.spend_reminder_enabled && !card.signup_bonus_earned) {
              return (
                <div className={`rounded-xl p-4 space-y-2 ${
                  isDeadlinePassed()
                    ? "border border-destructive/50 bg-destructive/5"
                    : isDeadlineApproaching()
                    ? "border border-orange-300 bg-orange-50 dark:border-orange-700 dark:bg-orange-950/20"
                    : "border bg-muted/30"
                }`}>
                  <div className="flex items-center gap-3">
                    <div className={`flex items-center justify-center w-8 h-8 rounded-full ${
                      isDeadlinePassed()
                        ? "bg-destructive/10"
                        : isDeadlineApproaching()
                        ? "bg-orange-100 dark:bg-orange-900/30"
                        : "bg-muted"
                    }`}>
                      <Clock className={`h-4 w-4 ${
                        isDeadlinePassed()
                          ? "text-destructive"
                          : isDeadlineApproaching()
                          ? "text-orange-600 dark:text-orange-400"
                          : "text-muted-foreground"
                      }`} />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium text-sm">
                          {card.signup_bonus_amount
                            ? `Earn ${card.signup_bonus_amount.toLocaleString()} ${card.signup_bonus_type || "points"}`
                            : "Spend Reminder"}
                        </h4>
                        <Badge variant="outline" className="text-xs">Signup</Badge>
                        {isDeadlineApproaching() && !isDeadlinePassed() && (
                          <Badge variant="warning" className="text-xs">Approaching</Badge>
                        )}
                        {isDeadlinePassed() && (
                          <Badge variant="destructive" className="text-xs">Past Due</Badge>
                        )}
                      </div>
                      {card.spend_requirement && (
                        <p className="text-sm text-muted-foreground">
                          Spend {formatCurrency(card.spend_requirement)} by {formatDate(card.spend_deadline)}
                        </p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs gap-1"
                      disabled={submittingAction !== null}
                      onClick={async () => {
                        setSubmittingAction("bonusAction");
                        try {
                          await updateCard(card.id, {
                            spend_reminder_enabled: false,
                            ...(card.signup_bonus_amount ? { signup_bonus_earned: true } : {
                              spend_requirement: null,
                              spend_deadline: null,
                              spend_reminder_notes: null,
                            }),
                          });
                          onUpdated();
                          toast.success(card.signup_bonus_amount ? "Bonus marked as earned" : "Spend reminder completed");
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Failed to update");
                        } finally {
                          setSubmittingAction(null);
                        }
                      }}
                    >
                      <Check className="h-3 w-3" />
                      {card.signup_bonus_amount ? "Mark as Earned" : "Complete"}
                    </Button>
                  </div>
                  {card.spend_reminder_notes && (
                    <p className="text-xs text-muted-foreground ml-11">{card.spend_reminder_notes}</p>
                  )}
                </div>
              );
            }
            // State B: Earned
            if (card.signup_bonus_earned && card.signup_bonus_amount) {
              return (
                <div className="rounded-xl p-4 border border-green-300 bg-green-50 dark:border-green-700 dark:bg-green-950/20">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-green-100 dark:bg-green-900/30">
                      <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-medium text-sm text-green-700 dark:text-green-300">Signup Bonus Earned</h4>
                      <p className="text-sm text-green-600 dark:text-green-400">
                        {card.signup_bonus_amount.toLocaleString()} {card.signup_bonus_type || "points"}
                      </p>
                    </div>
                  </div>
                </div>
              );
            }
            // State C: Has bonus amount but not earned and no spend tracking
            if (card.signup_bonus_amount && !card.signup_bonus_earned) {
              return (
                <div className="rounded-xl p-4 border bg-muted/30">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-muted">
                      <Trophy className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium text-sm">
                          {card.signup_bonus_amount.toLocaleString()} {card.signup_bonus_type || "points"}
                        </h4>
                        <Badge variant="outline" className="text-xs">Signup</Badge>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs gap-1"
                      disabled={submittingAction !== null}
                      onClick={async () => {
                        setSubmittingAction("bonusAction");
                        try {
                          await updateCard(card.id, { signup_bonus_earned: true });
                          onUpdated();
                          toast.success("Bonus marked as earned");
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Failed to update");
                        } finally {
                          setSubmittingAction(null);
                        }
                      }}
                    >
                      <Check className="h-3 w-3" />
                      Mark as Earned
                    </Button>
                  </div>
                </div>
              );
            }
            return null;
          })()}
          {/* Upgrade / Retention bonuses */}
          {visibleBonuses.map((bonus) => {
            const deadlineDate = bonus.spend_deadline ? parseDateStr(bonus.spend_deadline) : null;
            const daysLeft = deadlineDate ? Math.ceil((deadlineDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)) : null;
            const isPastDue = daysLeft !== null && daysLeft < 0;
            const isApproaching = daysLeft !== null && daysLeft <= 30 && daysLeft >= 0;
            const sourceLabel = bonus.bonus_source === "retention" ? "Retention" : "Upgrade";

            if (bonus.bonus_earned) {
              return (
                <div key={bonus.id} className="rounded-xl p-4 border border-green-300 bg-green-50 dark:border-green-700 dark:bg-green-950/20">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-green-100 dark:bg-green-900/30">
                      <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-medium text-sm text-green-700 dark:text-green-300">{sourceLabel} Bonus Earned</h4>
                      <p className="text-sm text-green-600 dark:text-green-400">
                        {bonus.bonus_amount?.toLocaleString()} {bonus.bonus_type || "points"}
                      </p>
                      {bonus.description && (
                        <p className="text-xs text-green-600/70 dark:text-green-400/70">{bonus.description}</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            }

            if (bonus.bonus_missed) {
              return (
                <div key={bonus.id} className="rounded-xl p-4 border bg-muted/20 opacity-60">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-muted">
                      <Ban className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-medium text-sm text-muted-foreground line-through">{sourceLabel} Bonus Missed</h4>
                      <p className="text-sm text-muted-foreground line-through">
                        {bonus.bonus_amount?.toLocaleString()} {bonus.bonus_type || "points"}
                      </p>
                      {bonus.description && (
                        <p className="text-xs text-muted-foreground/70">{bonus.description}</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            }

            if (!bonus.spend_reminder_enabled) return null;

            return (
              <div key={bonus.id} className={`rounded-xl p-4 space-y-2 ${
                isPastDue
                  ? "border border-destructive/50 bg-destructive/5"
                  : isApproaching
                  ? "border border-orange-300 bg-orange-50 dark:border-orange-700 dark:bg-orange-950/20"
                  : "border bg-muted/30"
              }`}>
                <div className="flex items-center gap-3">
                  <div className={`flex items-center justify-center w-8 h-8 rounded-full ${
                    isPastDue
                      ? "bg-destructive/10"
                      : isApproaching
                      ? "bg-orange-100 dark:bg-orange-900/30"
                      : "bg-muted"
                  }`}>
                    <Clock className={`h-4 w-4 ${
                      isPastDue
                        ? "text-destructive"
                        : isApproaching
                        ? "text-orange-600 dark:text-orange-400"
                        : "text-muted-foreground"
                    }`} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium text-sm">
                        {bonus.bonus_amount
                          ? `Earn ${bonus.bonus_amount.toLocaleString()} ${bonus.bonus_type || "points"}`
                          : `${sourceLabel} Bonus`}
                      </h4>
                      <Badge variant="outline" className="text-xs">{sourceLabel}</Badge>
                      {isApproaching && !isPastDue && (
                        <Badge variant="warning" className="text-xs">Approaching</Badge>
                      )}
                      {isPastDue && (
                        <Badge variant="destructive" className="text-xs">Past Due</Badge>
                      )}
                    </div>
                    {bonus.spend_requirement && (
                      <p className="text-sm text-muted-foreground">
                        Spend {formatCurrency(bonus.spend_requirement)} by {formatDate(bonus.spend_deadline)}
                      </p>
                    )}
                    {bonus.description && (
                      <p className="text-xs text-muted-foreground/70">{bonus.description}</p>
                    )}
                  </div>
                  <div className="flex gap-1">
                    {isPastDue && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs gap-1 text-destructive hover:text-destructive"
                        disabled={submittingAction !== null}
                        onClick={async () => {
                          setSubmittingAction("bonusAction");
                          try {
                            await updateBonus(bonus.id, {
                              bonus_missed: true,
                              spend_reminder_enabled: false,
                            });
                            onUpdated();
                            toast.success("Bonus marked as missed");
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : "Failed to update");
                          } finally {
                            setSubmittingAction(null);
                          }
                        }}
                      >
                        <Ban className="h-3 w-3" />
                        Missed
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs gap-1"
                      disabled={submittingAction !== null}
                      onClick={async () => {
                        setSubmittingAction("bonusAction");
                        try {
                          await updateBonus(bonus.id, {
                            bonus_earned: true,
                            spend_reminder_enabled: false,
                          });
                          onUpdated();
                          toast.success("Bonus marked as earned");
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Failed to mark bonus as earned");
                        } finally {
                          setSubmittingAction(null);
                        }
                      }}
                    >
                      <Check className="h-3 w-3" />
                      Earned
                    </Button>
                  </div>
                </div>
                {bonus.spend_reminder_notes && (
                  <p className="text-xs text-muted-foreground ml-11">{bonus.spend_reminder_notes}</p>
                )}
              </div>
            );
          })}
          </>}
        </div>
        );
      })()}

      {/* Section 4 — Tags & Notes */}
      <div className="space-y-3">
        <div className="h-px" style={{ backgroundColor: accentTint }} />
        {card.custom_tags && card.custom_tags.length > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            {card.custom_tags.map((tag) => (
              <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
            ))}
          </div>
        )}
        <div className="rounded-lg border bg-muted/20 p-3">
          <div className="flex items-center justify-between mb-1">
            <h4 className="font-medium text-sm">Notes</h4>
            {!editingNotes && (
              <button
                onClick={() => { setNotesValue(card.custom_notes || ""); setEditingNotes(true); }}
                className="p-0.5 rounded hover:bg-muted"
                aria-label="Edit notes"
              >
                <Pencil className="h-3 w-3 text-muted-foreground" />
              </button>
            )}
          </div>
          {editingNotes ? (
            <div className="space-y-2">
              <textarea
                autoFocus
                value={notesValue}
                onChange={(e) => setNotesValue(e.target.value)}
                maxLength={5000}
                className="w-full text-sm bg-background border rounded-md p-2 min-h-[60px] resize-y outline-none focus:ring-1 focus:ring-ring"
                placeholder="Add notes..."
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{notesValue.length}/5000</span>
              </div>
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  onClick={async () => {
                    try {
                      await updateCard(card.id, { custom_notes: notesValue || null });
                      setEditingNotes(false);
                      onUpdated();
                      toast.success("Notes saved");
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Failed to save notes");
                    }
                  }}
                >
                  Save
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingNotes(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            card.custom_notes
              ? <p className="text-sm text-muted-foreground whitespace-pre-wrap">{card.custom_notes}</p>
              : <p className="text-sm text-muted-foreground italic">No notes</p>
          )}
        </div>
      </div>

      {/* Section 5 — Event Timeline */}
      <div className="space-y-3">
        <div className="h-px" style={{ backgroundColor: accentTint }} />
        <div className="flex items-center gap-2">
          <h4 className="font-medium text-sm">Event Timeline</h4>
          <Badge variant="secondary" className="text-xs">{sortedEvents.length} event{sortedEvents.length !== 1 ? "s" : ""}</Badge>
        </div>
        {sortedEvents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events recorded.</p>
        ) : (
          <div className="relative">
            <div className="absolute left-[15px] top-0 bottom-0 w-0.5 bg-muted" />
            <div className="space-y-3">
              {(() => {
                const nextFeeInfo = getNextFeeInfo(card.open_date, card.annual_fee, card.status, card.annual_fee_date, today);
                if (!nextFeeInfo) return null;
                return (
                  <div className="relative flex items-start gap-3 pl-10">
                    <div className="absolute left-[4px] top-0.5 w-[22px] h-[22px] rounded-full flex items-center justify-center ring-2 ring-background border-2 border-dashed border-orange-400 bg-orange-50 dark:bg-orange-950/30">
                      <CalendarClock className="h-3 w-3 text-orange-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs px-1.5 py-0.5 rounded-md font-medium bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300 italic">
                          Upcoming Fee
                        </span>
                        <span className="text-xs text-muted-foreground italic">
                          ~{format(nextFeeInfo.nextDate, "MMM yyyy")}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-0.5 italic">
                        {nextFeeInfo.label} — around {format(nextFeeInfo.nextDate, "MMM yyyy")}
                      </p>
                    </div>
                  </div>
                );
              })()}
              {sortedEvents.map((event) => {
                const meta = getEventMeta(event.event_type);
                const Icon = meta.icon;
                const isEditing = editingEventId === event.id;
                return (
                  <div key={event.id} className="relative flex items-start gap-3 pl-10">
                    <div className={`absolute left-[4px] top-0.5 w-[22px] h-[22px] rounded-full flex items-center justify-center ring-2 ring-background ${meta.colorClass}`}>
                      <Icon className="h-3 w-3 text-white" />
                    </div>
                    {isEditing ? (
                      <div className="flex-1 min-w-0 space-y-2 rounded-lg border bg-muted/30 p-3">
                        {editEventType !== "annual_fee_posted" && editEventType !== "annual_fee_refund" && (
                          <div className="space-y-1.5">
                            <Label className="text-xs">Event Type</Label>
                            <Select value={editEventType} onValueChange={setEditEventType}>
                              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="opened">Opened</SelectItem>
                                <SelectItem value="closed">Closed</SelectItem>
                                <SelectItem value="annual_fee_posted">Annual Fee Posted</SelectItem>
                                <SelectItem value="annual_fee_refund">Annual Fee Refund</SelectItem>
                                <SelectItem value="product_change">Product Change</SelectItem>
                                <SelectItem value="retention_offer">Retention Offer</SelectItem>
                                <SelectItem value="other">Other</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                        <div className="space-y-1.5">
                          <Label className="text-xs">Date</Label>
                          <DatePicker value={editEventDate} onChange={setEditEventDate} placeholder="Select date" />
                        </div>
                        {(editEventType === "annual_fee_posted" || editEventType === "annual_fee_refund") && (
                          <div className="space-y-1.5">
                            <Label className="text-xs">{editEventType === "annual_fee_refund" ? "Refund Amount ($)" : "Annual Fee ($)"}</Label>
                            <Input className="h-8 text-xs w-24" type="number" value={editEventFee} onChange={(e) => setEditEventFee(e.target.value)} placeholder="0" />
                          </div>
                        )}
                        <div className="space-y-1.5">
                          <Label className="text-xs">{editEventType === "annual_fee_posted" || editEventType === "annual_fee_refund" ? "Note" : "Description"}</Label>
                          <Input className="h-8 text-xs" value={editEventDesc} onChange={(e) => setEditEventDesc(e.target.value)} placeholder={editEventType === "annual_fee_posted" || editEventType === "annual_fee_refund" ? "Add a note (optional)" : ""} maxLength={1000} />
                        </div>
                        <div className="flex gap-1.5">
                          <Button size="sm" className="h-7 text-xs" onClick={handleEditEvent} disabled={submittingAction !== null}>{submittingAction === "editEvent" ? "Saving..." : "Save"}</Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={cancelEditEvent}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex-1 min-w-0 group">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-xs px-1.5 py-0.5 rounded-md font-medium ${meta.badgeColor}`}>
                            {meta.label}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {(event.event_type === "annual_fee_posted" || event.event_type === "annual_fee_refund") && (event.metadata_json as Record<string, unknown> | null)?.approximate_date
                              ? "~" + format(parseDateStr(event.event_date), "MMM yyyy")
                              : formatDate(event.event_date)}
                          </span>
                          <button
                            onClick={() => startEditEvent(event)}
                            className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted"
                            aria-label="Edit event"
                          >
                            <Pencil className="h-3 w-3 text-muted-foreground" />
                          </button>
                        </div>
                        {(event.event_type === "annual_fee_posted" || event.event_type === "annual_fee_refund") && event.metadata_json && (event.metadata_json as Record<string, unknown>).annual_fee != null && (
                          <span className={`text-sm font-medium ${event.event_type === "annual_fee_refund" ? "text-green-600 dark:text-green-400" : ""}`}>
                            {event.event_type === "annual_fee_refund" ? "-" : ""}{formatCurrency((event.metadata_json as Record<string, unknown>).annual_fee as number)}
                          </span>
                        )}
                        {event.description && (
                          <p className="text-sm text-muted-foreground mt-0.5">{event.description}</p>
                        )}
                        {event.metadata_json && event.event_type === "product_change" && (
                          <div className="flex items-center gap-1.5 mt-1">
                            <span className="text-xs bg-muted px-2 py-0.5 rounded">
                              {(event.metadata_json as Record<string, string>).from_name}
                            </span>
                            <ArrowRight className="h-3 w-3 text-muted-foreground" />
                            <span className="text-xs bg-muted px-2 py-0.5 rounded">
                              {(event.metadata_json as Record<string, string>).to_name}
                            </span>
                          </div>
                        )}
                        {event.metadata_json && event.event_type === "retention_offer" && (() => {
                          const rm = event.metadata_json as Record<string, unknown>;
                          return (
                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                              {!!rm.offer_points && <span className="text-xs bg-muted px-2 py-0.5 rounded">{Number(rm.offer_points).toLocaleString()} points</span>}
                              {!!rm.offer_credit && <span className="text-xs bg-muted px-2 py-0.5 rounded">${Number(rm.offer_credit)} credit</span>}
                              <Badge variant={rm.accepted !== false ? "success" : "secondary"} className="text-[10px]">
                                {rm.accepted !== false ? "Accepted" : "Declined"}
                              </Badge>
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Section 6 — Actions */}
      <div className="space-y-3">
        <div className="h-px" style={{ backgroundColor: accentTint }} />
        <div className="flex gap-2 flex-wrap">
          {card.status === "active" && (
            <Button size="sm" variant="destructive" className="gap-1.5" onClick={() => setShowCloseForm(!showCloseForm)}>
              <Ban className="h-3.5 w-3.5" />
              Close Card
            </Button>
          )}
          {card.status === "closed" && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={submittingAction !== null}
              onClick={async () => {
                setSubmittingAction("reopen");
                try {
                  await reopenCard(card.id);
                  onUpdated();
                  toast.success("Card reopened");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Failed to reopen card");
                } finally {
                  setSubmittingAction(null);
                }
              }}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Reopen Card
            </Button>
          )}
          <Button size="sm" variant="outline" className="gap-1.5" onClick={openEditForm}>
            <Pencil className="h-3.5 w-3.5" />
            Edit Card
          </Button>
          {card.status === "active" && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowPCForm(!showPCForm)}>
              <ArrowLeftRight className="h-3.5 w-3.5" />
              Product Change
            </Button>
          )}
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowEventForm(!showEventForm)}>
            <PlusCircle className="h-3.5 w-3.5" />
            Add Event
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-destructive hover:bg-destructive/10"
            onClick={() => setConfirmingDelete(true)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete Card
          </Button>
        </div>
      </div>

      {/* Delete confirmation */}
      {confirmingDelete && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-3 space-y-2">
          <p className="text-sm font-medium text-destructive">
            Permanently delete this card and all its events, benefits, and bonuses?
          </p>
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="outline" onClick={() => setConfirmingDelete(false)} disabled={submittingAction !== null}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={submittingAction !== null}
              onClick={async () => {
                setSubmittingAction("delete");
                try {
                  await deleteCard(card.id);
                  onDeleted?.();
                  toast(`${card.card_name} deleted`, {
                    action: {
                      label: "Undo",
                      onClick: async () => {
                        try {
                          await restoreCard(card.id);
                          toast.success(`${card.card_name} restored`);
                          onUpdated();
                        } catch {
                          toast.error("Failed to restore card");
                        }
                      },
                    },
                    duration: 10000,
                  });
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Failed to delete card");
                } finally {
                  setSubmittingAction(null);
                  setConfirmingDelete(false);
                }
              }}
            >
              {submittingAction === "delete" ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </div>
      )}

      {/* Section 7 — Forms */}
      {showEditForm && (
        <div className="rounded-xl border bg-muted/30 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Pencil className="h-4 w-4 text-primary" />
              <h4 className="font-medium text-sm">Edit Card</h4>
            </div>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { tryCloseEditForm(); }}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* Identity */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Card Name</Label>
              <Input className="h-8 text-sm" value={ef.card_name} onChange={(e) => updateEf("card_name", e.target.value)} maxLength={100} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Issuer</Label>
              <Input className="h-8 text-sm" value={ef.issuer} onChange={(e) => updateEf("issuer", e.target.value)} maxLength={100} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Network</Label>
              <Input className="h-8 text-sm" value={ef.network} onChange={(e) => updateEf("network", e.target.value)} placeholder="e.g. Visa, Mastercard" maxLength={50} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Card Type</Label>
              <Select value={ef.card_type} onValueChange={(v) => updateEf("card_type", v)}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="personal">Personal</SelectItem>
                  <SelectItem value="business">Business</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Dates & Financials */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Open Date</Label>
              <DatePicker value={ef.open_date} onChange={(v) => updateEf("open_date", v)} placeholder="Select date" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Annual Fee ($)</Label>
              <Input className="h-8 text-sm" type="number" min="0" value={ef.annual_fee} onChange={(e) => updateEf("annual_fee", e.target.value)} placeholder="0" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Next Fee Date</Label>
              <DatePicker value={ef.annual_fee_date} onChange={(v) => updateEf("annual_fee_date", v)} placeholder="Select date" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Credit Limit ($)</Label>
              <Input className="h-8 text-sm" type="number" min="1" value={ef.credit_limit} onChange={(e) => updateEf("credit_limit", e.target.value)} placeholder="0" />
            </div>
          </div>

          {/* Signup Bonus */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Signup Bonus Amount</Label>
              <Input className="h-8 text-sm" type="number" min="1" value={ef.signup_bonus_amount} onChange={(e) => updateEf("signup_bonus_amount", e.target.value)} placeholder="e.g. 60000" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Bonus Type</Label>
              <Input className="h-8 text-sm" value={ef.signup_bonus_type} onChange={(e) => updateEf("signup_bonus_type", e.target.value)} placeholder="e.g. points, miles" maxLength={50} />
            </div>
          </div>

          {/* Spend Reminder */}
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Spend Requirement ($)</Label>
                <Input className="h-8 text-sm" type="number" min="1" value={ef.spend_requirement} onChange={(e) => updateEf("spend_requirement", e.target.value)} placeholder="e.g. 4000" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Spend Deadline</Label>
                <DatePicker value={ef.spend_deadline} onChange={(v) => updateEf("spend_deadline", v)} placeholder="Select date" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Spend Reminder Notes</Label>
              <Input className="h-8 text-sm" value={ef.spend_reminder_notes} onChange={(e) => updateEf("spend_reminder_notes", e.target.value)} placeholder="Optional notes" maxLength={1000} />
            </div>
          </div>

          {/* Tags */}
          <div className="space-y-1.5">
            <Label className="text-xs">Tags (comma-separated)</Label>
            <Input className="h-8 text-sm" value={ef.custom_tags} onChange={(e) => updateEf("custom_tags", e.target.value)} placeholder="e.g. travel, dining, keeper" />
          </div>

          {/* Card Art */}
          {(() => {
            if (!card.template_id) return null;
            const tmpl = editTemplates.find((t) => t.id === card.template_id);
            if (!tmpl || tmpl.images.length <= 1) return null;
            return (
              <div className="space-y-1.5">
                <Label className="text-xs">Card Art</Label>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {tmpl.images.map((filename) => (
                    <button
                      key={filename}
                      type="button"
                      onClick={() => updateEf("card_image", filename === tmpl.images[0] ? null : filename)}
                      className={`shrink-0 rounded-md overflow-hidden border-2 transition-all ${
                        (ef.card_image === filename || (ef.card_image === null && filename === tmpl.images[0]))
                          ? "border-primary ring-2 ring-primary/20"
                          : "border-transparent hover:border-muted-foreground/30"
                      }`}
                    >
                      <img
                        src={getTemplateImageVariantUrl(tmpl.id, filename)}
                        alt={filename}
                        className="w-20 h-[50px] object-cover"
                      />
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}

          <div className="flex gap-2">
            <Button size="sm" onClick={handleSaveEdit} disabled={submittingAction !== null || !ef.card_name?.trim() || !ef.issuer?.trim()}>
              {submittingAction === "edit" ? "Saving..." : "Save Changes"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { tryCloseEditForm(); }}>Cancel</Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={showDiscardConfirm}
        onOpenChange={setShowDiscardConfirm}
        title="Discard Changes"
        description="You have unsaved changes. Discard them?"
        confirmLabel="Discard"
        variant="destructive"
        onConfirm={() => { setShowDiscardConfirm(false); setShowEditForm(false); }}
      />

      {showCloseForm && (
        <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Ban className="h-4 w-4 text-destructive" />
              <h4 className="font-medium text-sm">Close Card</h4>
            </div>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setShowCloseForm(false); setConfirmingClose(false); }}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="space-y-2">
            <Label>Close Date</Label>
            <DatePicker value={closeDate} onChange={setCloseDate} placeholder="Select close date" />
          </div>
          {!confirmingClose ? (
            <Button size="sm" variant="destructive" onClick={() => setConfirmingClose(true)} disabled={!closeDate}>Close Card</Button>
          ) : (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-2">
              <p className="text-sm text-destructive">Are you sure? This card will be marked as closed.</p>
              <div className="flex gap-2">
                <Button size="sm" variant="destructive" onClick={handleClose} disabled={submittingAction !== null}>{submittingAction === "close" ? "Closing..." : "Yes, Close"}</Button>
                <Button size="sm" variant="outline" onClick={() => setConfirmingClose(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {showPCForm && (
        <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ArrowLeftRight className="h-4 w-4 text-blue-500" />
              <h4 className="font-medium text-sm">Product Change</h4>
            </div>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setShowPCForm(false)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* Issuer filter */}
          <div className="space-y-1.5">
            <Label className="text-xs">Filter by Issuer</Label>
            <Select value={pcIssuerFilter} onValueChange={(v) => { setPcIssuerFilter(v); setPcSelectedTemplate("custom"); }}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__current__">{card.issuer} (Current)</SelectItem>
                <SelectItem value="__all__">All Issuers</SelectItem>
                {pcIssuers
                  .filter((iss) => iss.toLowerCase() !== card.issuer.toLowerCase())
                  .map((iss) => (
                    <SelectItem key={iss} value={iss}>{iss}</SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          {/* Template selector */}
          <div className="space-y-1.5">
            <Label className="text-xs">New Card Template</Label>
            <Select value={pcSelectedTemplate} onValueChange={handlePcTemplateChange}>
              <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select template" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="custom">Custom Card (No Template)</SelectItem>
                {pcFilteredTemplates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}{pcIssuerFilter !== "__all__" ? "" : ` (${t.issuer})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Image picker */}
          {(() => {
            if (pcSelectedTemplate === "custom") return null;
            const tmpl = pcTemplates.find((t) => t.id === pcSelectedTemplate);
            if (!tmpl || tmpl.images.length <= 1) return null;
            return (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Card Art</Label>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {tmpl.images.map((filename) => (
                    <button
                      key={filename}
                      type="button"
                      onClick={() => setPcSelectedImage(filename === tmpl.images[0] ? null : filename)}
                      className={`shrink-0 rounded-md overflow-hidden border-2 transition-all ${
                        (pcSelectedImage === filename || (pcSelectedImage === null && filename === tmpl.images[0]))
                          ? "border-primary ring-2 ring-primary/20"
                          : "border-transparent hover:border-muted-foreground/30"
                      }`}
                    >
                      <img
                        src={getTemplateImageVariantUrl(tmpl.id, filename)}
                        alt={filename}
                        className="w-20 h-[50px] object-cover"
                      />
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Benefits preview */}
          {(() => {
            if (pcSelectedTemplate === "custom") return null;
            const tmpl = pcTemplates.find((t) => t.id === pcSelectedTemplate);
            const credits = tmpl?.benefits?.credits;
            const thresholds = tmpl?.benefits?.spend_thresholds;
            const hasCredits = credits && credits.length > 0;
            const hasThresholds = thresholds && thresholds.length > 0;
            if (!hasCredits && !hasThresholds) return null;
            return (
              <div className="rounded-lg border bg-muted/20 p-3 space-y-1">
                {hasCredits && (
                  <>
                    <p className="text-xs font-medium text-muted-foreground">Credits:</p>
                    {credits.map((c, i) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <span>{c.name}</span>
                        <span className="text-muted-foreground text-xs">
                          ${c.amount}{frequencyShort(c.frequency)} ({c.reset_type})
                        </span>
                      </div>
                    ))}
                  </>
                )}
                {hasThresholds && (
                  <>
                    <p className="text-xs font-medium text-muted-foreground mt-2">Spend thresholds:</p>
                    {thresholds.map((t, i) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <span>{t.name}</span>
                        <span className="text-muted-foreground text-xs">
                          ${t.spend_required.toLocaleString()}{frequencyShort(t.frequency)} ({t.reset_type})
                        </span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            );
          })()}

          {/* Card name */}
          <div className="space-y-1.5">
            <Label className="text-xs">New Card Name</Label>
            <Input className="h-8 text-sm" value={pcName} onChange={(e) => setPcName(e.target.value)} placeholder="e.g. Freedom Unlimited" maxLength={100} />
          </div>

          {/* Annual fee + Network */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Annual Fee ($)</Label>
              <Input className="h-8 text-sm" type="number" min="0" value={pcAnnualFee} onChange={(e) => setPcAnnualFee(e.target.value)} placeholder="0" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Network</Label>
              <Input className="h-8 text-sm" value={pcNetwork} onChange={(e) => setPcNetwork(e.target.value)} placeholder="e.g. Visa" maxLength={50} />
            </div>
          </div>

          {/* Change date */}
          <div className="space-y-1.5">
            <Label className="text-xs">Change Date</Label>
            <DatePicker value={pcDate} onChange={setPcDate} placeholder="Select change date" />
          </div>

          {/* Sync benefits toggle */}
          <div className="flex items-center gap-2">
            <Switch
              checked={pcSyncBenefits}
              onCheckedChange={setPcSyncBenefits}
              disabled={pcSelectedTemplate === "custom"}
            />
            <Label className="text-sm font-normal">Update benefits from new template</Label>
          </div>

          {/* Reset AF anniversary toggle */}
          <div className="flex items-center gap-2">
            <Switch
              checked={pcResetAfAnniversary}
              onCheckedChange={setPcResetAfAnniversary}
            />
            <Label className="text-sm font-normal">Reset annual fee anniversary to change date</Label>
          </div>

          {/* Upgrade bonus toggle */}
          <div className="flex items-center gap-2">
            <Switch
              checked={pcUpgradeBonus}
              onCheckedChange={setPcUpgradeBonus}
            />
            <Label className="text-sm font-normal">Include upgrade bonus</Label>
          </div>

          {pcUpgradeBonus && (
            <div className="rounded-lg border bg-muted/20 p-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Bonus Amount</Label>
                  <Input className="h-8 text-sm" type="number" min="1" value={pcUpgradeBonusAmount} onChange={(e) => setPcUpgradeBonusAmount(e.target.value)} placeholder="e.g. 150000" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Bonus Type</Label>
                  <Input className="h-8 text-sm" value={pcUpgradeBonusType} onChange={(e) => setPcUpgradeBonusType(e.target.value)} placeholder="e.g. points, miles" maxLength={100} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Spend Requirement ($)</Label>
                  <Input className="h-8 text-sm" type="number" min="1" value={pcUpgradeSpendReq} onChange={(e) => setPcUpgradeSpendReq(e.target.value)} placeholder="e.g. 6000" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Spend Deadline</Label>
                  <DatePicker value={pcUpgradeSpendDeadline} onChange={setPcUpgradeSpendDeadline} placeholder="Select date" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Spend Reminder Notes</Label>
                <Input className="h-8 text-sm" value={pcUpgradeSpendNotes} onChange={(e) => setPcUpgradeSpendNotes(e.target.value)} placeholder="Optional notes" maxLength={1000} />
              </div>
            </div>
          )}

          <Button size="sm" onClick={handleProductChange} disabled={submittingAction !== null || !pcName?.trim() || !pcDate || (pcUpgradeBonus && !pcUpgradeBonusAmount)}>
            {submittingAction === "productChange" ? "Saving..." : "Confirm Product Change"}
          </Button>
        </div>
      )}

      {showEventForm && (
        <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <PlusCircle className="h-4 w-4 text-primary" />
              <h4 className="font-medium text-sm">Add Event</h4>
            </div>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setShowEventForm(false)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="space-y-2">
            <Label>Event Type</Label>
            <Select value={eventType} onValueChange={setEventType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="annual_fee_posted">Annual Fee Posted</SelectItem>
                <SelectItem value="annual_fee_refund">Annual Fee Refund</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Event Date</Label>
            <DatePicker value={eventDate} onChange={setEventDate} placeholder="Select event date" />
          </div>
          {(eventType === "annual_fee_posted" || eventType === "annual_fee_refund") && (
            <div className="space-y-2">
              <Label>{eventType === "annual_fee_refund" ? "Refund Amount" : "Fee Amount"}</Label>
              <Input type="number" value={eventFee} onChange={(e) => setEventFee(e.target.value)} placeholder="e.g. 550" />
            </div>
          )}
          <div className="space-y-2">
            <Label>Description (optional)</Label>
            <Input value={eventDesc} onChange={(e) => setEventDesc(e.target.value)} maxLength={1000} />
          </div>
          <Button size="sm" onClick={handleAddEvent} disabled={submittingAction !== null}>{submittingAction === "event" ? "Adding..." : "Add Event"}</Button>
        </div>
      )}
    </div>
  );
}
