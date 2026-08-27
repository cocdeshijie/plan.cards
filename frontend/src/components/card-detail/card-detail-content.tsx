"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { Card, CardEvent, CardTemplate, CardSecretMasked } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { closeCard, reopenCard, createCardEvent, getTemplates, getTemplateImageUrl, getTemplateImageVariantUrl, PLACEHOLDER_IMAGE_URL, productChange, updateCard, updateEvent, deleteEvent, updateBonus, deleteBonus, deleteCard, restoreCard, getCardSecrets } from "@/lib/api";
import { frequencyShort, resetTypeLabel } from "@/lib/benefit-utils";
import { formatDate, formatCurrency, parseMoneyField, parseDateStr } from "@/lib/utils";
import { maskLastDigits } from "@/lib/card-number";
import { useToday } from "@/hooks/use-timezone";
import { getNextFeeInfo } from "@/lib/fee-utils";
import { AnnualFeeHistorySection } from "@/components/card-detail/annual-fee-history-section";
import { BenefitsSection } from "@/components/card-detail/benefits-section";
import { BonusCategoriesSection } from "@/components/card-detail/bonus-categories-section";
import { RetentionHistorySection } from "@/components/card-detail/retention-history-section";
import { useCardSections } from "@/hooks/use-card-sections";
import { toast } from "sonner";
import { format } from "date-fns";
import { useColorExtraction } from "@/hooks/use-color-extraction";
import { getEventMeta } from "@/lib/event-icons";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CardSecretDialog } from "@/components/card-details/card-secret-dialog";
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
  Lock,
} from "lucide-react";

/** Status and card type are stored lowercase ("active", "personal") and were
 *  printed raw here while every other surface capitalises them. */
function titleCase(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

/** Bonus types that are dollars rather than a point count. A retention offer
 *  stored as amount 500 / type "credit" was rendering as "500 credit". */
const MONEY_BONUS_TYPES = new Set([
  "credit",
  "credits",
  "statement credit",
  "cashback",
  "cash back",
  "cash",
  "dollars",
  "usd",
]);

function formatBonusValue(amount: number | null | undefined, type: string | null | undefined): string {
  const label = (type || "points").trim();
  if (amount == null) return label;
  return MONEY_BONUS_TYPES.has(label.toLowerCase())
    ? `${formatCurrency(amount)} ${label}`
    : `${amount.toLocaleString()} ${label}`;
}

/**
 * Is an extracted card-art colour safe to use as a border?
 *
 * The accent is the average colour of arbitrary artwork, so a near-black or
 * near-white card face produced a border that vanished into the matching
 * theme's background and left the stat tiles and section rules edgeless. The
 * `hsl()` placeholder the extraction hook returns before it has an answer is
 * rejected for the same reason — applying it painted the borders faint for a
 * frame on every open.
 */
function accentIsUsable(color: string): boolean {
  const m = /^rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(color);
  if (!m) return false;
  const channel = (raw: string) => {
    const c = Number(raw) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(m[1]) + 0.7152 * channel(m[2]) + 0.0722 * channel(m[3]);
  return luminance > 0.04 && luminance < 0.92;
}

interface CardDetailContentProps {
  card: Card;
  onUpdated: () => void;
  onDeleted?: () => void;
  profileName?: string;
  /** Reports whether the Edit Card form holds unsaved changes, so the dialog or
   *  drawer around this content can guard Esc / overlay / drag dismissal with
   *  the same Discard prompt the form's own X and Cancel use. */
  onDirtyChange?: (dirty: boolean) => void;
}

export function CardDetailContent({ card, onUpdated, onDeleted, profileName, onDirtyChange }: CardDetailContentProps) {
  const { isExpanded, toggle, expand } = useCardSections(card.id);

  // Stored card details live in their own table with their own endpoints, so
  // this block saves independently of the Edit Card form around it.
  const [secretEntry, setSecretEntry] = useState<CardSecretMasked | null>(null);
  const [showSecretDialog, setShowSecretDialog] = useState(false);
  // "nothing stored" and "we couldn't ask" are different answers. Collapsing the
  // failure to null invited the user to re-enter a number that is already there
  // — and re-entering it overwrites the stored one.
  const [secretStatus, setSecretStatus] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const loadSecret = useCallback(async () => {
    setSecretStatus("loading");
    try {
      const all = await getCardSecrets();
      setSecretEntry(all.find((s) => s.card_id === card.id) ?? null);
      setSecretStatus("loaded");
    } catch {
      setSecretEntry(null);
      setSecretStatus("error");
    }
  }, [card.id]);
  const today = useToday();
  // One id namespace per mounted card so every Label can point at its control.
  const uid = useId();
  const fid = (name: string) => `${uid}-${name}`;
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
  const [deletingTimelineEventId, setDeletingTimelineEventId] = useState<number | null>(null);
  const [editEventDesc, setEditEventDesc] = useState("");
  const [editEventDate, setEditEventDate] = useState<Date | undefined>();
  const [editEventType, setEditEventType] = useState("");
  const [editEventFee, setEditEventFee] = useState("");
  const [showEditForm, setShowEditForm] = useState(false);

  // Every one of these panels renders away from the button that opens it —
  // three below the fold, and Add Event a couple of hundred lines above its own
  // button — so opening one looked like nothing had happened and the second
  // click closed a form the user never saw.
  const editFormRef = useRef<HTMLFormElement>(null);
  const closeFormRef = useRef<HTMLFormElement>(null);
  const pcFormRef = useRef<HTMLFormElement>(null);
  const eventFormRef = useRef<HTMLFormElement>(null);
  useEffect(() => { if (showEditForm) editFormRef.current?.scrollIntoView({ block: "nearest" }); }, [showEditForm]);
  useEffect(() => { if (showCloseForm) closeFormRef.current?.scrollIntoView({ block: "nearest" }); }, [showCloseForm]);
  useEffect(() => { if (showPCForm) pcFormRef.current?.scrollIntoView({ block: "nearest" }); }, [showPCForm]);
  useEffect(() => { if (showEventForm) eventFormRef.current?.scrollIntoView({ block: "nearest" }); }, [showEventForm]);

  // Only when the form is actually open — this is one request per open, and
  // there's no reason to make it for every card the user merely looks at.
  useEffect(() => {
    if (showEditForm) loadSecret();
  }, [showEditForm, loadSecret]);
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
  // The dialog/drawer owns Esc, the overlay click and the drag-down; it can only
  // ask the same question the X and Cancel ask if it knows the form is dirty.
  const editFormDirty = isEditFormDirty();
  useEffect(() => { onDirtyChange?.(editFormDirty); }, [editFormDirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  const [submittingAction, setSubmittingAction] = useState<string | null>(null);

  // Every field, not the five that used to be reset here: reopening the form
  // carried the previous attempt's change date and upgrade bonus over, so last
  // session's bonus could be submitted against a different template.
  const resetPcForm = useCallback(() => {
    setPcIssuerFilter("__current__");
    setPcSelectedTemplate("custom");
    setPcName("");
    setPcAnnualFee("");
    setPcNetwork("");
    setPcDate(undefined);
    setPcSyncBenefits(true);
    setPcResetAfAnniversary(true);
    setPcSelectedImage(null);
    setPcUpgradeBonus(false);
    setPcUpgradeBonusAmount("");
    setPcUpgradeBonusType("");
    setPcUpgradeSpendReq("");
    setPcUpgradeSpendDeadline(undefined);
    setPcUpgradeSpendNotes("");
  }, []);

  // Fetch templates when PC form opens
  useEffect(() => {
    if (showPCForm) {
      getTemplates().then(setPcTemplates).catch(() => toast.error("Failed to load templates"));
      resetPcForm();
    }
  }, [showPCForm, resetPcForm]);

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
      // The name, fee and network were filled in from the previous template, so
      // they go with it — the form used to read "Custom Card" while still
      // showing "Freedom Unlimited / $0 / Visa".
      setPcName("");
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
  const accentColor = useColorExtraction(imgError ? null : imageUrl);
  const accentUsable = useMemo(() => accentIsUsable(accentColor), [accentColor]);
  // Fall back to the border token rather than an unusable accent, so the tiles
  // and section rules always have an edge in both themes.
  const accentTint = accentUsable
    ? `color-mix(in srgb, ${accentColor} 15%, transparent)`
    : "hsl(var(--border))";
  const accentBorder = accentUsable
    ? `color-mix(in srgb, ${accentColor} 30%, transparent)`
    : "hsl(var(--border))";

  const nextFeeInfo = useMemo(
    () => getNextFeeInfo(card.open_date, card.annual_fee, card.status, card.annual_fee_date, today),
    [card.open_date, card.annual_fee, card.status, card.annual_fee_date, today],
  );

  // Templates are only fetched when a form that needs them opens, so the stat
  // tile humanises the slug rather than printing "chase/freedom_flex".
  const templateLabel = useMemo(() => {
    if (!card.template_id) return "Custom";
    const tmpl = editTemplates.find((t) => t.id === card.template_id);
    if (tmpl) return tmpl.name;
    const slug = card.template_id.split("/").pop() ?? card.template_id;
    return slug.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }, [card.template_id, editTemplates]);

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
        ...(isAF && eventFee
          ? { metadata_json: { annual_fee: parseMoneyField(eventFee, eventType === "annual_fee_refund" ? "Refund amount" : "Fee amount") } }
          : {}),
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
      const annualFee = parseMoneyField(pcAnnualFee, "Annual fee") ?? undefined;
      const network = pcNetwork || undefined;
      const upgradeBonusData = pcUpgradeBonus && pcUpgradeBonusAmount
        ? {
            amount: parseMoneyField(pcUpgradeBonusAmount, "Bonus amount") ?? 0,
            type: pcUpgradeBonusType || undefined,
            spendRequirement: parseMoneyField(pcUpgradeSpendReq, "Spend requirement") ?? undefined,
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
      resetPcForm();
      setPcTemplates([]);
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
          metadata_json: { ...cleanMeta, annual_fee: parseMoneyField(editEventFee, editEventType === "annual_fee_refund" ? "Refund amount" : "Annual fee") },
        });
      } else {
        await updateEvent(editingEventId, {
          event_type: editEventType,
          event_date: format(editEventDate, "yyyy-MM-dd"),
          description: editEventDesc || null,
        });
      }
      // The timeline filters retention offers out — they live in their own
      // section, which defaults collapsed — so "Event updated" beside a row that
      // had just vanished read as data loss. Open the section it moved into.
      const movedToRetention = editEventType === "retention_offer";
      cancelEditEvent();
      onUpdated();
      if (movedToRetention) {
        expand("retention");
        toast.success("Moved to Retention History");
      } else {
        toast.success("Event updated");
      }
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

      // parseMoneyField (lib/utils) throws on an unparseable amount instead of
      // reporting "cleared" — its docblock carries the silent-wipe story this
      // local copy used to. The catch below turns the throw into a toast.
      const newAF = parseMoneyField(ef.annual_fee, "Annual fee");
      if (newAF !== card.annual_fee) updates.annual_fee = newAF;

      const newAFDate = ef.annual_fee_date ? format(ef.annual_fee_date, "yyyy-MM-dd") : null;
      if (newAFDate !== card.annual_fee_date) updates.annual_fee_date = newAFDate;

      const newCL = parseMoneyField(ef.credit_limit, "Credit limit");
      if (newCL !== card.credit_limit) updates.credit_limit = newCL;

      const newTags = ef.custom_tags.split(",").map((t) => t.trim()).filter(Boolean);
      const oldTags = card.custom_tags || [];
      if (JSON.stringify(newTags) !== JSON.stringify(oldTags))
        updates.custom_tags = newTags.length > 0 ? newTags : null;

      const newSBA = parseMoneyField(ef.signup_bonus_amount, "Signup bonus amount");
      if (newSBA !== card.signup_bonus_amount) updates.signup_bonus_amount = newSBA;
      const newSBT = ef.signup_bonus_type || null;
      if (newSBT !== card.signup_bonus_type) updates.signup_bonus_type = newSBT;

      const newSR = parseMoneyField(ef.spend_requirement, "Spend requirement");
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

  // The fee row is a pseudo-entry, not a stored event, so it has to be merged
  // into the newest-first order by hand. Pinning it to the top put a fee that
  // came due last year above every event that has happened since; a fee still
  // in the future lands at the top anyway, which is where it belongs.
  type TimelineRow =
    | { kind: "fee"; info: NonNullable<typeof nextFeeInfo> }
    | { kind: "event"; event: CardEvent };
  const timelineRows: TimelineRow[] = sortedEvents.map((event) => ({ kind: "event", event }));
  if (nextFeeInfo) {
    const feeTime = nextFeeInfo.nextDate.getTime();
    const at = timelineRows.findIndex(
      (r) => r.kind === "event" && parseDateStr(r.event.event_date).getTime() <= feeTime,
    );
    const feeRow: TimelineRow = { kind: "fee", info: nextFeeInfo };
    if (at === -1) timelineRows.push(feeRow);
    else timelineRows.splice(at, 0, feeRow);
  }

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
              {/* Clamped: the caption is bottom-anchored inside a 180px image, so
                  a long name on a narrow phone pushed its own first lines up out
                  of the picture and into clipped space. */}
              <h2 className="text-lg sm:text-xl font-semibold text-white mb-1.5 line-clamp-2 break-words" title={card.card_name}>
                {card.card_name}
                {card.last_digits && <span className="font-normal text-white/60"> {maskLastDigits(card.last_digits)}</span>}
              </h2>
              <div className="flex items-center gap-2 mb-2">
                <p className="text-sm text-white/80 min-w-0 truncate" title={profileName ? `${card.issuer} · ${profileName}` : card.issuer}>
                  {card.issuer}
                  {profileName && <span className="text-white/70"> &middot; {profileName}</span>}
                </p>
                {editingLastDigits ? (
                  <input
                    autoFocus
                    aria-label="Last digits"
                    inputMode="numeric"
                    autoComplete="off"
                    enterKeyHint="done"
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
                    /* text-base below sm: anything under 16px makes iOS zoom the
                       page on focus and never zooms back out. */
                    className="shrink-0 bg-white/20 text-white text-base sm:text-xs rounded px-1.5 py-0.5 w-[92px] sm:w-[72px] outline-none focus-visible:ring-2 focus-visible:ring-white/70 placeholder:text-white/50"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => { setLastDigitsValue(card.last_digits || ""); setEditingLastDigits(true); }}
                    /* Padding plus a compensating negative margin: this is the
                       only affordance for last_digits in this view, and it sat
                       at 12px in a dense caption row. */
                    className="shrink-0 text-white/70 hover:text-white transition-colors p-2.5 -m-1.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                    aria-label={card.last_digits ? `Edit last digits, currently ${card.last_digits}` : "Add last digits"}
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <Badge variant={card.status === "active" ? "success" : "secondary"} className="text-xs">
                  {titleCase(card.status)}
                </Badge>
                <Badge className="text-xs bg-white/20 text-white border-white/20 hover:bg-white/30">
                  {titleCase(card.card_type)}
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
            <h2 className="text-lg font-semibold break-words" title={card.card_name}>
              {card.card_name}
              {card.last_digits && <span className="text-muted-foreground font-normal"> {maskLastDigits(card.last_digits)}</span>}
            </h2>
            <Badge variant={card.status === "active" ? "success" : "secondary"}>
              {titleCase(card.status)}
            </Badge>
            <Badge variant="outline">{titleCase(card.card_type)}</Badge>
            {card.network && <Badge variant="outline">{card.network}</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">{card.issuer}</p>
        </div>
      )}

      {/* Section 2 — Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {(() => {
          const feeValueClass = nextFeeInfo?.proximity === "overdue"
            ? "text-red-600 dark:text-red-400"
            : nextFeeInfo?.proximity === "imminent"
            ? "text-orange-600 dark:text-orange-400"
            : nextFeeInfo?.proximity === "soon"
            ? "text-yellow-600 dark:text-yellow-400"
            : undefined;
          return [
            { icon: Calendar, label: "Opened", value: formatDate(card.open_date) },
            { icon: Calendar, label: "Closed", value: formatDate(card.close_date) },
            { icon: DollarSign, label: "Annual Fee", value: formatCurrency(card.annual_fee) },
            {
              icon: CalendarClock,
              label: "Next Fee",
              value: nextFeeInfo?.label ?? "\u2014",
              valueClass: feeValueClass,
              title: nextFeeInfo ? `${nextFeeInfo.label} — ${format(nextFeeInfo.nextDate, "MMM d, yyyy")}` : undefined,
            },
            { icon: Landmark, label: "Credit Limit", value: card.credit_limit ? formatCurrency(card.credit_limit) : "\u2014" },
            { icon: FileText, label: "Template", value: templateLabel, title: card.template_id || "Custom" },
          ] as { icon: typeof Calendar; label: string; value: string; valueClass?: string; title?: string }[];
        })().map(({ icon: Icon, label, value, valueClass, title }) => (
          <div
            key={label}
            className="rounded-lg border p-3 min-w-0"
            style={{ borderColor: accentBorder }}
          >
            <div className="flex items-center gap-1.5 mb-1">
              <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-xs text-muted-foreground">{label}</span>
            </div>
            <p className={`text-sm font-medium truncate ${valueClass ?? ""}`} title={title ?? value}>{value}</p>
          </div>
        ))}
      </div>

      {/* Section 2.5 — Annual Fee History */}
      <AnnualFeeHistorySection card={card} accentTint={accentTint} onUpdated={onUpdated} expanded={isExpanded("af")} onToggleExpand={() => toggle("af")} onExpand={() => expand("af")} />

      {/* Section 2.5b — Benefits & Credits */}
      <BenefitsSection card={card} accentTint={accentTint} onUpdated={onUpdated} expanded={isExpanded("benefits")} onToggleExpand={() => toggle("benefits")} onExpand={() => expand("benefits")} />

      {/* Section 2.5b2 — Reward Categories */}
      <BonusCategoriesSection
        card={card}
        accentTint={accentTint}
        onUpdated={onUpdated}
        expanded={isExpanded("rewards")}
        onToggleExpand={() => toggle("rewards")}
        onExpand={() => expand("rewards")}
      />

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
            <button type="button" onClick={() => toggle("bonuses")} aria-expanded={isExpanded("bonuses")} className="flex items-center gap-2 min-h-[44px] sm:min-h-0 rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
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
                    <div className={`shrink-0 flex items-center justify-center w-8 h-8 rounded-full ${
                      isDeadlinePassed()
                        ? "bg-destructive/10"
                        : isDeadlineApproaching()
                        ? "bg-orange-100 dark:bg-orange-900/30"
                        : "bg-muted"
                    }`}>
                      <Clock className={`h-4 w-4 ${
                        isDeadlinePassed()
                          ? "text-danger"
                          : isDeadlineApproaching()
                          ? "text-orange-600 dark:text-orange-400"
                          : "text-muted-foreground"
                      }`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h5 className="font-medium text-sm break-words">
                          {card.signup_bonus_amount
                            ? `Earn ${formatBonusValue(card.signup_bonus_amount, card.signup_bonus_type)}`
                            : "Spend Reminder"}
                        </h5>
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
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs gap-1 shrink-0"
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
                    <p className="text-xs text-muted-foreground ml-11 break-words">{card.spend_reminder_notes}</p>
                  )}
                </div>
              );
            }
            // State B: Earned
            if (card.signup_bonus_earned && card.signup_bonus_amount) {
              return (
                <div className="rounded-xl p-4 border border-green-300 bg-green-50 dark:border-green-700 dark:bg-green-950/20">
                  <div className="flex items-center gap-3">
                    <div className="shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-green-100 dark:bg-green-900/30">
                      <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h5 className="font-medium text-sm text-green-700 dark:text-green-300">Signup Bonus Earned</h5>
                      <p className="text-sm text-green-600 dark:text-green-400 break-words">
                        {formatBonusValue(card.signup_bonus_amount, card.signup_bonus_type)}
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
                    <div className="shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-muted">
                      <Trophy className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h5 className="font-medium text-sm break-words">
                          {formatBonusValue(card.signup_bonus_amount, card.signup_bonus_type)}
                        </h5>
                        <Badge variant="outline" className="text-xs">Signup</Badge>
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs gap-1 shrink-0"
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
                    <div className="shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-green-100 dark:bg-green-900/30">
                      <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h5 className="font-medium text-sm text-green-700 dark:text-green-300">{sourceLabel} Bonus Earned</h5>
                      <p className="text-sm text-green-600 dark:text-green-400 break-words">
                        {formatBonusValue(bonus.bonus_amount, bonus.bonus_type)}
                        {bonus.bonus_credit_amount != null && ` + ${formatCurrency(bonus.bonus_credit_amount)} credit`}
                      </p>
                      {bonus.description && (
                        <p className="text-xs text-green-600/70 dark:text-green-400/70 break-words">{bonus.description}</p>
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
                    <div className="shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-muted">
                      <Ban className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h5 className="font-medium text-sm text-muted-foreground line-through">{sourceLabel} Bonus Missed</h5>
                      <p className="text-sm text-muted-foreground line-through break-words">
                        {formatBonusValue(bonus.bonus_amount, bonus.bonus_type)}
                        {bonus.bonus_credit_amount != null && ` + ${formatCurrency(bonus.bonus_credit_amount)} credit`}
                      </p>
                      {bonus.description && (
                        <p className="text-xs text-muted-foreground/70 break-words">{bonus.description}</p>
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
                  <div className={`shrink-0 flex items-center justify-center w-8 h-8 rounded-full ${
                    isPastDue
                      ? "bg-destructive/10"
                      : isApproaching
                      ? "bg-orange-100 dark:bg-orange-900/30"
                      : "bg-muted"
                  }`}>
                    <Clock className={`h-4 w-4 ${
                      isPastDue
                        ? "text-danger"
                        : isApproaching
                        ? "text-orange-600 dark:text-orange-400"
                        : "text-muted-foreground"
                    }`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h5 className="font-medium text-sm break-words">
                        {bonus.bonus_amount
                          ? `Earn ${formatBonusValue(bonus.bonus_amount, bonus.bonus_type)}${bonus.bonus_credit_amount != null ? ` + ${formatCurrency(bonus.bonus_credit_amount)} credit` : ""}`
                          : `${sourceLabel} Bonus`}
                      </h5>
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
                      <p className="text-xs text-muted-foreground/70 break-words">{bonus.description}</p>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {isPastDue && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs gap-1 text-danger hover:text-danger"
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
                      type="button"
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
                  <p className="text-xs text-muted-foreground ml-11 break-words">{bonus.spend_reminder_notes}</p>
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
                type="button"
                onClick={() => { setNotesValue(card.custom_notes || ""); setEditingNotes(true); }}
                className="p-2.5 -m-1.5 rounded hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
                aria-label="Notes"
                value={notesValue}
                onChange={(e) => setNotesValue(e.target.value)}
                maxLength={5000}
                disabled={submittingAction === "notes"}
                /* text-base below sm for the same reason the Input primitive
                   does it: anything under 16px makes iOS zoom on focus. */
                className="w-full text-base sm:text-sm bg-background border rounded-md p-2 min-h-[60px] resize-y outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                placeholder="Add notes..."
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{notesValue.length}/5000</span>
              </div>
              <div className="flex gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={submittingAction !== null}
                  onClick={async () => {
                    setSubmittingAction("notes");
                    try {
                      await updateCard(card.id, { custom_notes: notesValue || null });
                      setEditingNotes(false);
                      onUpdated();
                      toast.success("Notes saved");
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Failed to save notes");
                    } finally {
                      setSubmittingAction(null);
                    }
                  }}
                >
                  {submittingAction === "notes" ? "Saving..." : "Save"}
                </Button>
                <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" disabled={submittingAction === "notes"} onClick={() => setEditingNotes(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            card.custom_notes
              ? <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words">{card.custom_notes}</p>
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
        {showEventForm && (
          <form
            ref={eventFormRef}
            className="rounded-xl border bg-muted/30 p-4 space-y-3"
            onSubmit={(e) => { e.preventDefault(); if (submittingAction !== null || !eventDate) return; handleAddEvent(); }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <PlusCircle className="h-4 w-4 text-primary" />
                <h5 className="font-medium text-sm">Add Event</h5>
              </div>
              <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0" aria-label="Close add event form" onClick={() => setShowEventForm(false)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="space-y-2">
              <Label htmlFor={fid("event-type")}>Event Type</Label>
              <Select value={eventType} onValueChange={setEventType}>
                <SelectTrigger id={fid("event-type")}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="annual_fee_posted">Annual Fee Posted</SelectItem>
                  <SelectItem value="annual_fee_refund">Annual Fee Refund</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {/* DatePicker exposes no id, so the label names the group instead
                of the trigger — the wrapper was already here. */}
            <div className="space-y-2" role="group" aria-labelledby={fid("event-date-label")}>
              <Label id={fid("event-date-label")}>Event Date</Label>
              <DatePicker value={eventDate} onChange={setEventDate} placeholder="Select event date" />
            </div>
            {(eventType === "annual_fee_posted" || eventType === "annual_fee_refund") && (
              <div className="space-y-2">
                <Label htmlFor={fid("event-fee")}>{eventType === "annual_fee_refund" ? "Refund Amount" : "Fee Amount"}</Label>
                <Input id={fid("event-fee")} type="number" min="0" inputMode="numeric" enterKeyHint="done" value={eventFee} onChange={(e) => setEventFee(e.target.value)} placeholder="e.g. 550" />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor={fid("event-desc")}>Description (optional)</Label>
              <Input id={fid("event-desc")} enterKeyHint="done" value={eventDesc} onChange={(e) => setEventDesc(e.target.value)} maxLength={1000} />
            </div>
            {/* Disabled without a date: handleAddEvent early-returned, so the
                button looked live and did nothing. */}
            <Button type="submit" size="sm" disabled={submittingAction !== null || !eventDate}>{submittingAction === "event" ? "Adding..." : "Add Event"}</Button>
          </form>
        )}
        {timelineRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events recorded.</p>
        ) : (
          <div className="relative">
            <div className="absolute left-[15px] top-0 bottom-0 w-0.5 bg-muted" />
            <div className="space-y-3">
              {timelineRows.map((row) => {
                if (row.kind === "fee") {
                  const overdue = row.info.overdue;
                  return (
                    <div key="upcoming-fee" className="relative flex items-start gap-3 pl-10">
                      <div className={`absolute left-[4px] top-0.5 w-[22px] h-[22px] rounded-full flex items-center justify-center ring-2 ring-background border-2 border-dashed ${overdue ? "border-red-400 bg-red-50 dark:bg-red-950/30" : "border-orange-400 bg-orange-50 dark:bg-orange-950/30"}`}>
                        <CalendarClock className={`h-3 w-3 ${overdue ? "text-red-500" : "text-orange-500"}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {/* The badge follows the label's tense: an overdue fee
                              was reading "Upcoming Fee — was due 212 days ago". */}
                          <span className={`text-xs px-1.5 py-0.5 rounded-md font-medium italic ${overdue ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" : "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300"}`}>
                            {overdue ? "Fee Overdue" : "Upcoming Fee"}
                          </span>
                          <span className="text-xs text-muted-foreground italic">
                            ~{format(row.info.nextDate, "MMM yyyy")}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground mt-0.5 italic break-words">
                          {formatCurrency(card.annual_fee)} annual fee {overdue ? row.info.label : `due ${row.info.label}`}
                        </p>
                      </div>
                    </div>
                  );
                }
                const event = row.event;
                const meta = getEventMeta(event.event_type);
                const Icon = meta.icon;
                const isEditing = editingEventId === event.id;
                return (
                  <div key={event.id} className="relative flex items-start gap-3 pl-10">
                    <div className={`absolute left-[4px] top-0.5 w-[22px] h-[22px] rounded-full flex items-center justify-center ring-2 ring-background ${meta.colorClass}`}>
                      <Icon className="h-3 w-3 text-white" />
                    </div>
                    {isEditing ? (
                      <form
                        className="flex-1 min-w-0 space-y-2 rounded-lg border bg-muted/30 p-3"
                        onSubmit={(e) => { e.preventDefault(); if (submittingAction !== null || !editEventDate) return; handleEditEvent(); }}
                      >
                        {editEventType !== "annual_fee_posted" && editEventType !== "annual_fee_refund" && (
                          <div className="space-y-1.5">
                            <Label className="text-xs" htmlFor={fid(`event-${event.id}-type`)}>Event Type</Label>
                            <Select value={editEventType} onValueChange={setEditEventType}>
                              <SelectTrigger id={fid(`event-${event.id}-type`)} className="h-8 text-xs"><SelectValue /></SelectTrigger>
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
                        <div className="space-y-1.5" role="group" aria-labelledby={fid(`event-${event.id}-date`)}>
                          <Label className="text-xs" id={fid(`event-${event.id}-date`)}>Date</Label>
                          <DatePicker value={editEventDate} onChange={setEditEventDate} placeholder="Select date" />
                        </div>
                        {(editEventType === "annual_fee_posted" || editEventType === "annual_fee_refund") && (
                          <div className="space-y-1.5">
                            <Label className="text-xs" htmlFor={fid(`event-${event.id}-fee`)}>{editEventType === "annual_fee_refund" ? "Refund Amount ($)" : "Annual Fee ($)"}</Label>
                            <Input id={fid(`event-${event.id}-fee`)} className="h-8 text-sm w-24" type="number" min="0" inputMode="numeric" enterKeyHint="done" value={editEventFee} onChange={(e) => setEditEventFee(e.target.value)} placeholder="0" />
                          </div>
                        )}
                        <div className="space-y-1.5">
                          <Label className="text-xs" htmlFor={fid(`event-${event.id}-desc`)}>{editEventType === "annual_fee_posted" || editEventType === "annual_fee_refund" ? "Note" : "Description"}</Label>
                          <Input id={fid(`event-${event.id}-desc`)} className="h-8 text-sm" enterKeyHint="done" value={editEventDesc} onChange={(e) => setEditEventDesc(e.target.value)} placeholder={editEventType === "annual_fee_posted" || editEventType === "annual_fee_refund" ? "Add a note (optional)" : ""} maxLength={1000} />
                        </div>
                        <div className="flex gap-1.5">
                          <Button type="submit" size="sm" className="h-7 text-xs" disabled={submittingAction !== null || !editEventDate}>{submittingAction === "editEvent" ? "Saving..." : "Save"}</Button>
                          <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" disabled={submittingAction !== null} onClick={cancelEditEvent}>Cancel</Button>
                        </div>
                      </form>
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
                          {/* Hover-only reveals are unreachable on touch, so the
                              control is dimmed-but-present below sm. */}
                          <button
                            type="button"
                            onClick={() => startEditEvent(event)}
                            className="opacity-60 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity p-2.5 -m-1.5 rounded hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            aria-label={`Edit ${meta.label} event from ${formatDate(event.event_date)}`}
                          >
                            <Pencil className="h-3 w-3 text-muted-foreground" />
                          </button>
                          {!["opened", "closed", "product_change", "reopened"].includes(event.event_type) && (
                            deletingTimelineEventId === event.id ? (
                              <>
                                <button
                                  type="button"
                                  disabled={submittingAction !== null}
                                  onClick={async () => {
                                    setSubmittingAction("deleteEvent");
                                    try {
                                      await deleteEvent(event.id);
                                      setDeletingTimelineEventId(null);
                                      onUpdated();
                                      toast.success("Event deleted");
                                    } catch (e) {
                                      toast.error(e instanceof Error ? e.message : "Failed to delete event");
                                    } finally {
                                      setSubmittingAction(null);
                                    }
                                  }}
                                  className="text-xs text-danger font-medium px-1 py-2 -my-1 rounded hover:underline disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                >
                                  {submittingAction === "deleteEvent" ? "Deleting..." : "Delete?"}
                                </button>
                                <button
                                  type="button"
                                  disabled={submittingAction !== null}
                                  onClick={() => setDeletingTimelineEventId(null)}
                                  className="p-2.5 -m-1.5 rounded hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                  aria-label="Keep event"
                                >
                                  <X className="h-3 w-3 text-muted-foreground" />
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setDeletingTimelineEventId(event.id)}
                                className="opacity-60 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity p-2.5 -m-1.5 rounded hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                aria-label={`Delete ${meta.label} event from ${formatDate(event.event_date)}`}
                              >
                                <Trash2 className="h-3 w-3 text-muted-foreground hover:text-danger" />
                              </button>
                            )
                          )}
                        </div>
                        {(event.event_type === "annual_fee_posted" || event.event_type === "annual_fee_refund") && event.metadata_json && (event.metadata_json as Record<string, unknown>).annual_fee != null && (
                          <span className={`text-sm font-medium ${event.event_type === "annual_fee_refund" ? "text-green-600 dark:text-green-400" : ""}`}>
                            {event.event_type === "annual_fee_refund" ? "-" : ""}{formatCurrency((event.metadata_json as Record<string, unknown>).annual_fee as number)}
                          </span>
                        )}
                        {event.description && (
                          <p className="text-sm text-muted-foreground mt-0.5 break-words">{event.description}</p>
                        )}
                        {event.metadata_json && event.event_type === "product_change" && (
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <span className="text-xs bg-muted px-2 py-0.5 rounded break-words">
                              {(event.metadata_json as Record<string, string>).from_name}
                            </span>
                            <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span className="text-xs bg-muted px-2 py-0.5 rounded break-words">
                              {(event.metadata_json as Record<string, string>).to_name}
                            </span>
                          </div>
                        )}
                        {event.metadata_json && event.event_type === "retention_offer" && (() => {
                          const rm = event.metadata_json as Record<string, unknown>;
                          return (
                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                              {!!rm.offer_points && <span className="text-xs bg-muted px-2 py-0.5 rounded">{Number(rm.offer_points).toLocaleString()} points</span>}
                              {!!rm.offer_credit && <span className="text-xs bg-muted px-2 py-0.5 rounded">{formatCurrency(Number(rm.offer_credit))} credit</span>}
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
            <Button type="button" size="sm" variant="destructive" className="gap-1.5" aria-expanded={showCloseForm} onClick={() => setShowCloseForm(!showCloseForm)}>
              <Ban className="h-3.5 w-3.5" />
              Close Card
            </Button>
          )}
          {card.status === "closed" && (
            <Button
              type="button"
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
              {submittingAction === "reopen" ? "Reopening..." : "Reopen Card"}
            </Button>
          )}
          {/* A real toggle, like the three beside it: aria-expanded has to be
              honest, and a second click used to re-run openEditForm() — which
              resets every field from the card, silently discarding whatever was
              typed. Route the collapse through the same Discard guard. */}
          <Button type="button" size="sm" variant="outline" className="gap-1.5" aria-expanded={showEditForm} onClick={() => { if (showEditForm) tryCloseEditForm(); else openEditForm(); }}>
            <Pencil className="h-3.5 w-3.5" />
            Edit Card
          </Button>
          {card.status === "active" && (
            <Button type="button" size="sm" variant="outline" className="gap-1.5" aria-expanded={showPCForm} onClick={() => setShowPCForm(!showPCForm)}>
              <ArrowLeftRight className="h-3.5 w-3.5" />
              Product Change
            </Button>
          )}
          <Button type="button" size="sm" variant="outline" className="gap-1.5" aria-expanded={showEventForm} onClick={() => setShowEventForm(!showEventForm)}>
            <PlusCircle className="h-3.5 w-3.5" />
            Add Event
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5 text-danger hover:bg-destructive/10"
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
          <p className="text-sm font-medium text-danger break-words">
            Permanently delete {card.card_name} and all its events, benefits, and bonuses?
          </p>
          <div className="flex gap-2 justify-end">
            <Button type="button" size="sm" variant="outline" onClick={() => setConfirmingDelete(false)} disabled={submittingAction !== null}>
              Cancel
            </Button>
            <Button
              type="button"
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
        <form
          ref={editFormRef}
          className="rounded-xl border bg-muted/30 p-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (submittingAction !== null || !ef.card_name?.trim() || !ef.issuer?.trim()) return;
            handleSaveEdit();
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Pencil className="h-4 w-4 text-primary" />
              <h4 className="font-medium text-sm">Edit Card</h4>
            </div>
            <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0" aria-label="Close edit card form" onClick={() => { tryCloseEditForm(); }}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* Identity */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor={fid("edit-name")}>Card Name</Label>
              <Input id={fid("edit-name")} className="h-8 text-sm" enterKeyHint="next" value={ef.card_name} onChange={(e) => updateEf("card_name", e.target.value)} maxLength={100} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor={fid("edit-issuer")}>Issuer</Label>
              <Input id={fid("edit-issuer")} className="h-8 text-sm" enterKeyHint="next" value={ef.issuer} onChange={(e) => updateEf("issuer", e.target.value)} maxLength={100} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor={fid("edit-network")}>Network</Label>
              <Input id={fid("edit-network")} className="h-8 text-sm" enterKeyHint="next" value={ef.network} onChange={(e) => updateEf("network", e.target.value)} placeholder="e.g. Visa, Mastercard" maxLength={50} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor={fid("edit-type")}>Card Type</Label>
              <Select value={ef.card_type} onValueChange={(v) => updateEf("card_type", v)}>
                <SelectTrigger id={fid("edit-type")} className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="personal">Personal</SelectItem>
                  <SelectItem value="business">Business</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Dates & Financials */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5" role="group" aria-labelledby={fid("edit-open-date-label")}>
              <Label className="text-xs" id={fid("edit-open-date-label")}>Open Date</Label>
              <DatePicker value={ef.open_date} onChange={(v) => updateEf("open_date", v)} placeholder="Select date" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor={fid("edit-af")}>Annual Fee ($)</Label>
              <Input id={fid("edit-af")} className="h-8 text-sm" type="number" min="0" inputMode="numeric" enterKeyHint="next" value={ef.annual_fee} onChange={(e) => updateEf("annual_fee", e.target.value)} placeholder="0" />
            </div>
            <div className="space-y-1.5" role="group" aria-labelledby={fid("edit-af-date-label")}>
              <Label className="text-xs" id={fid("edit-af-date-label")}>Next Fee Date</Label>
              <DatePicker value={ef.annual_fee_date} onChange={(v) => updateEf("annual_fee_date", v)} placeholder="Select date" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor={fid("edit-cl")}>Credit Limit ($)</Label>
              <Input id={fid("edit-cl")} className="h-8 text-sm" type="number" min="1" inputMode="numeric" enterKeyHint="next" value={ef.credit_limit} onChange={(e) => updateEf("credit_limit", e.target.value)} placeholder="0" />
            </div>
          </div>

          {/* Signup Bonus */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor={fid("edit-sba")}>Signup Bonus Amount</Label>
              <Input id={fid("edit-sba")} className="h-8 text-sm" type="number" min="1" inputMode="numeric" enterKeyHint="next" value={ef.signup_bonus_amount} onChange={(e) => updateEf("signup_bonus_amount", e.target.value)} placeholder="e.g. 60000" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor={fid("edit-sbt")}>Bonus Type</Label>
              <Input id={fid("edit-sbt")} className="h-8 text-sm" enterKeyHint="next" value={ef.signup_bonus_type} onChange={(e) => updateEf("signup_bonus_type", e.target.value)} placeholder="e.g. points, miles" maxLength={50} />
            </div>
          </div>

          {/* Spend Reminder */}
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs" htmlFor={fid("edit-sr")}>Spend Requirement ($)</Label>
                <Input id={fid("edit-sr")} className="h-8 text-sm" type="number" min="1" inputMode="numeric" enterKeyHint="next" value={ef.spend_requirement} onChange={(e) => updateEf("spend_requirement", e.target.value)} placeholder="e.g. 4000" />
              </div>
              <div className="space-y-1.5" role="group" aria-labelledby={fid("edit-spend-deadline-label")}>
                <Label className="text-xs" id={fid("edit-spend-deadline-label")}>Spend Deadline</Label>
                <DatePicker value={ef.spend_deadline} onChange={(v) => updateEf("spend_deadline", v)} placeholder="Select date" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor={fid("edit-srn")}>Spend Reminder Notes</Label>
              <Input id={fid("edit-srn")} className="h-8 text-sm" enterKeyHint="next" value={ef.spend_reminder_notes} onChange={(e) => updateEf("spend_reminder_notes", e.target.value)} placeholder="Optional notes" maxLength={1000} />
            </div>
          </div>

          {/* Tags — the backend takes at most 20 tags of 50 characters, so the
              field is capped a little above what that can spell. */}
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor={fid("edit-tags")}>Tags (comma-separated)</Label>
            <Input id={fid("edit-tags")} className="h-8 text-sm" enterKeyHint="done" value={ef.custom_tags} onChange={(e) => updateEf("custom_tags", e.target.value)} placeholder="e.g. travel, dining, keeper" maxLength={1040} />
          </div>

          {/* Card Art */}
          {(() => {
            if (!card.template_id) return null;
            const tmpl = editTemplates.find((t) => t.id === card.template_id);
            if (!tmpl || tmpl.images.length <= 1) return null;
            return (
              <div className="space-y-1.5">
                {/* role=group + aria-pressed, because selection was carried by a
                    border alone and each option announced its filename. */}
                <Label className="text-xs" id={fid("edit-art-label")}>Card Art</Label>
                <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-labelledby={fid("edit-art-label")}>
                  {tmpl.images.map((filename, i) => {
                    const selected = ef.card_image === filename || (ef.card_image === null && filename === tmpl.images[0]);
                    return (
                      <button
                        key={filename}
                        type="button"
                        aria-pressed={selected}
                        aria-label={i === 0 ? "Default card art" : `Card art option ${i + 1}`}
                        onClick={() => updateEf("card_image", filename === tmpl.images[0] ? null : filename)}
                        className={`relative shrink-0 rounded-md overflow-hidden border-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          selected
                            ? "border-primary ring-2 ring-primary/20"
                            : "border-transparent hover:border-muted-foreground/30"
                        }`}
                      >
                        <img
                          src={getTemplateImageVariantUrl(tmpl.id, filename)}
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
            );
          })()}

          {/* Stored card details — saved separately from this form, because
              they live in their own encrypted table with their own endpoint. */}
          <div className="rounded-lg border bg-background p-3 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">Card details</p>
                  <p
                    className="text-xs text-muted-foreground truncate"
                    title={secretEntry ? `${secretEntry.masked_pan} · expires ${secretEntry.exp_display}` : undefined}
                  >
                    {secretStatus === "loading" || secretStatus === "idle" ? (
                      "Checking for stored details\u2026"
                    ) : secretStatus === "error" ? (
                      "Couldn't load stored details."
                    ) : secretEntry ? (
                      <>
                        <span className="font-mono tabular-nums">{secretEntry.masked_pan}</span>
                        {" · expires "}
                        {secretEntry.exp_display}
                      </>
                    ) : (
                      "Optional. Number, expiry and security code, encrypted at rest."
                    )}
                  </p>
                </div>
              </div>
              {secretStatus === "error" ? (
                <Button type="button" size="sm" variant="outline" className="h-8 shrink-0" onClick={() => { loadSecret(); }}>
                  Retry
                </Button>
              ) : (
                /* Disabled until the lookup lands: offering "Add" over details
                   that are already stored invites an overwrite. */
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 shrink-0"
                  disabled={secretStatus !== "loaded"}
                  onClick={() => setShowSecretDialog(true)}
                >
                  {secretEntry ? "Edit" : "Add"}
                </Button>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={submittingAction !== null || !ef.card_name?.trim() || !ef.issuer?.trim()}>
              {submittingAction === "edit" ? "Saving..." : "Save Changes"}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={submittingAction !== null} onClick={() => { tryCloseEditForm(); }}>Cancel</Button>
          </div>
        </form>
      )}

      <CardSecretDialog
        open={showSecretDialog}
        onClose={() => setShowSecretDialog(false)}
        onSaved={() => { loadSecret(); onUpdated(); }}
        cards={[card]}
        cardId={card.id}
        existing={secretEntry}
        lockCard
      />

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
        <form
          ref={closeFormRef}
          className="rounded-xl border bg-muted/30 p-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (submittingAction !== null || !closeDate) return;
            if (!confirmingClose) setConfirmingClose(true);
            else handleClose();
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Ban className="h-4 w-4 text-danger" />
              <h4 className="font-medium text-sm">Close Card</h4>
            </div>
            <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0" aria-label="Dismiss close card form" onClick={() => { setShowCloseForm(false); setConfirmingClose(false); }}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="space-y-2" role="group" aria-labelledby={fid("close-date-label")}>
            <Label id={fid("close-date-label")}>Close Date</Label>
            <DatePicker value={closeDate} onChange={setCloseDate} placeholder="Select close date" />
          </div>
          {!confirmingClose ? (
            <Button type="submit" size="sm" variant="destructive" disabled={!closeDate}>Close Card</Button>
          ) : (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-2">
              <p className="text-sm text-danger">Are you sure? This card will be marked as closed.</p>
              <div className="flex gap-2">
                <Button type="submit" size="sm" variant="destructive" disabled={submittingAction !== null}>{submittingAction === "close" ? "Closing..." : "Yes, Close"}</Button>
                <Button type="button" size="sm" variant="outline" disabled={submittingAction !== null} onClick={() => setConfirmingClose(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </form>
      )}

      {showPCForm && (
        <form
          ref={pcFormRef}
          className="rounded-xl border bg-muted/30 p-4 space-y-3"
          // The wrapper exists only to swallow implicit submission: a product
          // change is destructive (rewrites template_id/name/fee/network, writes
          // an event, re-syncs benefits and resets the AF anniversary) and has no
          // undo, so Enter in any of the seven text fields must never commit it.
          // The trigger below is a type="button" with an explicit onClick.
          onSubmit={(e) => e.preventDefault()}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ArrowLeftRight className="h-4 w-4 text-blue-500" />
              <h4 className="font-medium text-sm">Product Change</h4>
            </div>
            <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0" aria-label="Close product change form" onClick={() => { setShowPCForm(false); resetPcForm(); }}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* Issuer filter — switching it also clears the name, fee and network
              the previous template filled in. */}
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor={fid("pc-issuer")}>Filter by Issuer</Label>
            <Select value={pcIssuerFilter} onValueChange={(v) => { setPcIssuerFilter(v); handlePcTemplateChange("custom"); }}>
              <SelectTrigger id={fid("pc-issuer")} className="h-8 text-sm"><SelectValue /></SelectTrigger>
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
            <Label className="text-xs" htmlFor={fid("pc-template")}>New Card Template</Label>
            <Select value={pcSelectedTemplate} onValueChange={handlePcTemplateChange}>
              <SelectTrigger id={fid("pc-template")} className="h-8 text-sm"><SelectValue placeholder="Select template" /></SelectTrigger>
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
                <Label className="text-xs text-muted-foreground" id={fid("pc-art-label")}>Card Art</Label>
                <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-labelledby={fid("pc-art-label")}>
                  {tmpl.images.map((filename, i) => {
                    const selected = pcSelectedImage === filename || (pcSelectedImage === null && filename === tmpl.images[0]);
                    return (
                      <button
                        key={filename}
                        type="button"
                        aria-pressed={selected}
                        aria-label={i === 0 ? "Default card art" : `Card art option ${i + 1}`}
                        onClick={() => setPcSelectedImage(filename === tmpl.images[0] ? null : filename)}
                        className={`relative shrink-0 rounded-md overflow-hidden border-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          selected
                            ? "border-primary ring-2 ring-primary/20"
                            : "border-transparent hover:border-muted-foreground/30"
                        }`}
                      >
                        <img
                          src={getTemplateImageVariantUrl(tmpl.id, filename)}
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
                    <p className="text-xs font-medium text-muted-foreground mt-2">Spend thresholds:</p>
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

          {/* Card name */}
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor={fid("pc-name")}>New Card Name</Label>
            <Input id={fid("pc-name")} className="h-8 text-sm" enterKeyHint="next" value={pcName} onChange={(e) => setPcName(e.target.value)} placeholder="e.g. Freedom Unlimited" maxLength={100} />
          </div>

          {/* Annual fee + Network */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor={fid("pc-af")}>Annual Fee ($)</Label>
              <Input id={fid("pc-af")} className="h-8 text-sm" type="number" min="0" inputMode="numeric" enterKeyHint="next" value={pcAnnualFee} onChange={(e) => setPcAnnualFee(e.target.value)} placeholder="0" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor={fid("pc-network")}>Network</Label>
              <Input id={fid("pc-network")} className="h-8 text-sm" enterKeyHint="next" value={pcNetwork} onChange={(e) => setPcNetwork(e.target.value)} placeholder="e.g. Visa" maxLength={50} />
            </div>
          </div>

          {/* Change date */}
          <div className="space-y-1.5" role="group" aria-labelledby={fid("pc-date-label")}>
            <Label className="text-xs" id={fid("pc-date-label")}>Change Date</Label>
            <DatePicker value={pcDate} onChange={setPcDate} placeholder="Select change date" />
          </div>

          {/* Sync benefits toggle */}
          <div className="flex items-center gap-2">
            <Switch
              id={fid("pc-sync")}
              checked={pcSyncBenefits}
              onCheckedChange={setPcSyncBenefits}
              disabled={pcSelectedTemplate === "custom"}
            />
            <Label className="text-sm font-normal" htmlFor={fid("pc-sync")}>Update benefits from new template</Label>
          </div>

          {/* Reset AF anniversary toggle */}
          <div className="flex items-center gap-2">
            <Switch
              id={fid("pc-reset-af")}
              checked={pcResetAfAnniversary}
              onCheckedChange={setPcResetAfAnniversary}
            />
            <Label className="text-sm font-normal" htmlFor={fid("pc-reset-af")}>Reset annual fee anniversary to change date</Label>
          </div>

          {/* Upgrade bonus toggle */}
          <div className="flex items-center gap-2">
            <Switch
              id={fid("pc-upgrade-bonus")}
              checked={pcUpgradeBonus}
              onCheckedChange={setPcUpgradeBonus}
            />
            <Label className="text-sm font-normal" htmlFor={fid("pc-upgrade-bonus")}>Include upgrade bonus</Label>
          </div>

          {pcUpgradeBonus && (
            <div className="rounded-lg border bg-muted/20 p-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs" htmlFor={fid("pc-bonus-amount")}>Bonus Amount</Label>
                  <Input id={fid("pc-bonus-amount")} className="h-8 text-sm" type="number" min="1" inputMode="numeric" enterKeyHint="next" value={pcUpgradeBonusAmount} onChange={(e) => setPcUpgradeBonusAmount(e.target.value)} placeholder="e.g. 150000" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs" htmlFor={fid("pc-bonus-type")}>Bonus Type</Label>
                  <Input id={fid("pc-bonus-type")} className="h-8 text-sm" enterKeyHint="next" value={pcUpgradeBonusType} onChange={(e) => setPcUpgradeBonusType(e.target.value)} placeholder="e.g. points, miles" maxLength={100} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs" htmlFor={fid("pc-spend-req")}>Spend Requirement ($)</Label>
                  <Input id={fid("pc-spend-req")} className="h-8 text-sm" type="number" min="1" inputMode="numeric" enterKeyHint="next" value={pcUpgradeSpendReq} onChange={(e) => setPcUpgradeSpendReq(e.target.value)} placeholder="e.g. 6000" />
                </div>
                <div className="space-y-1.5" role="group" aria-labelledby={fid("pc-spend-deadline-label")}>
                  <Label className="text-xs" id={fid("pc-spend-deadline-label")}>Spend Deadline</Label>
                  <DatePicker value={pcUpgradeSpendDeadline} onChange={setPcUpgradeSpendDeadline} placeholder="Select date" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" htmlFor={fid("pc-spend-notes")}>Spend Reminder Notes</Label>
                <Input id={fid("pc-spend-notes")} className="h-8 text-sm" enterKeyHint="done" value={pcUpgradeSpendNotes} onChange={(e) => setPcUpgradeSpendNotes(e.target.value)} placeholder="Optional notes" maxLength={1000} />
              </div>
            </div>
          )}

          <Button type="button" size="sm" onClick={handleProductChange} disabled={submittingAction !== null || !pcName?.trim() || !pcDate || (pcUpgradeBonus && !pcUpgradeBonusAmount)}>
            {submittingAction === "productChange" ? "Saving..." : "Confirm Product Change"}
          </Button>
        </form>
      )}

    </div>
  );
}
