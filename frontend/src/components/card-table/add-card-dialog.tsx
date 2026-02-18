"use client";

import { useEffect, useState, useMemo } from "react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { DatePicker } from "@/components/ui/date-picker";
import { getTemplates, getTemplateImageVariantUrl, getTemplateVersions, createCard } from "@/lib/api";
import { frequencyShort } from "@/lib/benefit-utils";
import { parseIntStrict } from "@/lib/utils";
import { toast } from "sonner";
import { format } from "date-fns";

interface AddCardDialogProps {
  profiles: Profile[];
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  defaultProfileId?: number;
}

export function AddCardDialog({ profiles, open, onClose, onCreated, defaultProfileId }: AddCardDialogProps) {
  const [templates, setTemplates] = useState<CardTemplate[]>([]);
  const [templateSearch, setTemplateSearch] = useState("");
  const [issuerFilter, setIssuerFilter] = useState("all");
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

  useEffect(() => {
    if (open) {
      getTemplates().then(setTemplates).catch(() => {
        toast.error("Failed to load card templates");
      });
    }
  }, [open]);

  useEffect(() => {
    if (defaultProfileId) setProfileId(defaultProfileId.toString());
  }, [defaultProfileId]);

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
        if (issuerFilter !== "all" && t.issuer !== issuerFilter) return false;
        if (!templateSearch) return true;
        const q = templateSearch.toLowerCase();
        return t.name.toLowerCase().includes(q) || t.issuer.toLowerCase().includes(q);
      }),
    [templates, templateSearch, issuerFilter],
  );

  const formatDateStr = (d: Date | undefined) => d ? format(d, "yyyy-MM-dd") : null;

  const handleSubmit = async () => {
    const parsedProfileId = parseIntStrict(profileId);
    if (!parsedProfileId || !cardName.trim() || !issuer.trim()) return;
    setSubmitting(true);
    try {
      const currentVer = versions.find((v) => v.is_current);
      const templateVersionId = selectedTemplate !== "custom" && selectedVersion !== "current" && selectedVersion !== currentVer?.version_id
        ? selectedVersion
        : null;
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
        annual_fee: annualFee ? parseIntStrict(annualFee) ?? null : null,
        credit_limit: creditLimit ? parseIntStrict(creditLimit) ?? null : null,
        spend_reminder_enabled: spendReminderEnabled,
        spend_requirement: spendRequirement ? parseIntStrict(spendRequirement) ?? null : null,
        spend_deadline: formatDateStr(spendDeadline),
        spend_reminder_notes: spendReminderNotes || null,
        signup_bonus_amount: signupBonusAmount ? parseIntStrict(signupBonusAmount) ?? null : null,
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

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { resetForm(); onClose(); } }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Card</DialogTitle>
          <DialogDescription>Add a new card from a template or create a custom entry.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label>Profile</Label>
            <Select value={profileId} onValueChange={setProfileId}>
              <SelectTrigger><SelectValue placeholder="Select profile" /></SelectTrigger>
              <SelectContent>
                {profiles.map((p) => (
                  <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Template</Label>
            <div className="grid grid-cols-[1fr_auto] gap-1.5 mb-1.5">
              <Input
                placeholder="Search templates..."
                value={templateSearch}
                onChange={(e) => setTemplateSearch(e.target.value)}
              />
              <Select value={issuerFilter} onValueChange={setIssuerFilter}>
                <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Issuers</SelectItem>
                  {issuers.map((iss) => (
                    <SelectItem key={iss} value={iss}>{iss}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Select value={selectedTemplate} onValueChange={handleTemplateChange}>
              <SelectTrigger><SelectValue placeholder="Select template" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="custom">Custom Card</SelectItem>
                {filteredTemplates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name} ({t.issuer})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Version picker */}
          {selectedTemplate !== "custom" && versions.length > 1 && (
            <div>
              <Label>Version</Label>
              <Select value={selectedVersion} onValueChange={handleVersionChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {versions.map((v) => (
                    <SelectItem key={v.version_id} value={v.is_current ? "current" : v.version_id}>
                      {v.is_current ? "Current" : v.name} — ${v.annual_fee ?? 0}/yr
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {(() => {
            if (selectedTemplate === "custom") return null;
            const tmpl = templates.find((t) => t.id === selectedTemplate);
            const credits = tmpl?.benefits?.credits;
            const thresholds = tmpl?.benefits?.spend_thresholds;
            const hasCredits = credits && credits.length > 0;
            const hasThresholds = thresholds && thresholds.length > 0;
            if (!hasCredits && !hasThresholds) return null;
            return (
              <div className="rounded-lg border bg-muted/20 p-3 space-y-1">
                {hasCredits && (
                  <>
                    <p className="text-xs font-medium text-muted-foreground">Credits that will be auto-created:</p>
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
                    <p className="text-xs font-medium text-muted-foreground mt-2">Spend thresholds that will be tracked:</p>
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

          {/* Image picker */}
          {(() => {
            if (selectedTemplate === "custom") return null;
            const tmpl = templates.find((t) => t.id === selectedTemplate);
            if (!tmpl || tmpl.images.length <= 1) return null;
            return (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Card Art</Label>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {tmpl.images.map((filename) => (
                    <button
                      key={filename}
                      type="button"
                      onClick={() => setSelectedImage(filename === tmpl.images[0] ? null : filename)}
                      className={`shrink-0 rounded-md overflow-hidden border-2 transition-all ${
                        (selectedImage === filename || (selectedImage === null && filename === tmpl.images[0]))
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

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-3">
            <div>
              <Label>Card Name</Label>
              <Input value={cardName} onChange={(e) => setCardName(e.target.value)} maxLength={100} />
            </div>
            <div>
              <Label>Last 4/5</Label>
              <Input value={lastDigits} onChange={(e) => setLastDigits(e.target.value.replace(/\D/g, "").slice(0, 5))} placeholder="1234" className="w-[72px]" />
            </div>
            <div>
              <Label>Issuer</Label>
              <Input value={issuer} onChange={(e) => setIssuer(e.target.value)} maxLength={100} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label>Network</Label>
              <Input value={network} onChange={(e) => setNetwork(e.target.value)} placeholder="Visa" maxLength={50} />
            </div>
            <div>
              <Label>Type</Label>
              <Select value={cardType} onValueChange={setCardType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="personal">Personal</SelectItem>
                  <SelectItem value="business">Business</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Open Date</Label>
              <DatePicker value={openDate} onChange={setOpenDate} placeholder="Select date" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Annual Fee</Label>
              <Input type="number" min="0" value={annualFee} onChange={(e) => setAnnualFee(e.target.value)} placeholder="0" />
            </div>
            <div>
              <Label>Credit Limit</Label>
              <Input type="number" min="1" value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} />
            </div>
          </div>

          <div className="border rounded-xl p-3 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-medium text-sm">Spend Reminder</h4>
              <Switch checked={spendReminderEnabled} onCheckedChange={setSpendReminderEnabled} />
            </div>
            {spendReminderEnabled && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Spend Requirement ($)</Label>
                    <Input type="number" value={spendRequirement} onChange={(e) => setSpendRequirement(e.target.value)} placeholder="4000" />
                  </div>
                  <div>
                    <Label>Deadline</Label>
                    <DatePicker value={spendDeadline} onChange={setSpendDeadline} placeholder="Select date" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Signup Bonus Amount</Label>
                    <Input type="number" value={signupBonusAmount} onChange={(e) => setSignupBonusAmount(e.target.value)} placeholder="60000" />
                  </div>
                  <div>
                    <Label>Bonus Type</Label>
                    <Input value={signupBonusType} onChange={(e) => setSignupBonusType(e.target.value)} placeholder="e.g. Ultimate Rewards" maxLength={100} />
                  </div>
                </div>
                <div>
                  <Label>Notes</Label>
                  <Input value={spendReminderNotes} onChange={(e) => setSpendReminderNotes(e.target.value)} placeholder="e.g. Need to hit $4k in 3 months" maxLength={1000} />
                </div>
              </div>
            )}
          </div>

          <Button className="w-full" onClick={handleSubmit} disabled={submitting || !profileId || !cardName.trim() || !issuer.trim()}>
            {submitting ? "Adding..." : "Add Card"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
