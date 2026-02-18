export interface Profile {
  id: number;
  name: string;
  created_at: string;
}

export interface CardEvent {
  id: number;
  card_id: number;
  event_type: "opened" | "closed" | "product_change" | "annual_fee_posted" | "annual_fee_refund" | "retention_offer" | "reopened" | "other";
  event_date: string;
  description: string | null;
  metadata_json: Record<string, unknown> | null;
  created_at: string;
}

export interface Card {
  id: number;
  profile_id: number;
  template_id: string | null;
  template_version_id: string | null;
  card_image: string | null;
  card_name: string;
  last_digits: string | null;
  issuer: string;
  network: string | null;
  card_type: "personal" | "business";
  status: "active" | "closed";
  open_date: string | null;
  close_date: string | null;
  annual_fee: number | null;
  annual_fee_date: string | null;
  credit_limit: number | null;
  custom_notes: string | null;
  custom_tags: string[] | null;
  spend_reminder_enabled: boolean;
  spend_requirement: number | null;
  spend_deadline: string | null;
  spend_reminder_notes: string | null;
  signup_bonus_amount: number | null;
  signup_bonus_type: string | null;
  signup_bonus_earned: boolean;
  created_at: string;
  updated_at: string;
  events: CardEvent[];
  bonuses: CardBonus[];
}

export interface CardBonus {
  id: number;
  card_id: number;
  event_id: number | null;
  bonus_source: string;
  bonus_amount: number | null;
  bonus_credit_amount: number | null;
  bonus_type: string | null;
  bonus_earned: boolean;
  bonus_missed: boolean;
  spend_requirement: number | null;
  spend_deadline: string | null;
  spend_reminder_enabled: boolean;
  spend_reminder_notes: string | null;
  description: string | null;
  created_at: string;
}

export interface CardBenefit {
  id: number;
  card_id: number;
  benefit_name: string;
  benefit_amount: number;
  frequency: string;
  reset_type: string;
  benefit_type: string;
  from_template: boolean;
  retired: boolean;
  notes: string | null;
  amount_used: number;
  period_start: string | null;
  period_end: string | null;
  days_until_reset: number | null;
  reset_label: string | null;
  created_at: string;
}

export interface BenefitSummaryItem extends CardBenefit {
  card_name: string;
  issuer: string;
  last_digits: string | null;
  template_id: string | null;
  card_image: string | null;
  profile_id: number;
  profile_name: string;
}

export interface CardBenefitCreate {
  benefit_name: string;
  benefit_amount: number;
  frequency: string;
  reset_type?: string;
  benefit_type?: string;
  notes?: string | null;
}

export interface CardBenefitUpdate {
  benefit_name?: string;
  benefit_amount?: number;
  frequency?: string;
  reset_type?: string;
  benefit_type?: string;
  notes?: string | null;
}

export interface BenefitUsageUpdate {
  amount_used: number;
}

export interface TemplateCredit {
  name: string;
  amount: number;
  frequency: string;
  reset_type: string;
}

export interface TemplateBonusCategory {
  category: string;
  multiplier: string;
  portal_only?: boolean;
  cap?: number | null;
}

export interface CardBonusCategory {
  id: number;
  card_id: number;
  category: string;
  multiplier: string;
  portal_only: boolean;
  cap: number | null;
  from_template: boolean;
  created_at: string;
}

export interface TemplateSpendThreshold {
  name: string;
  spend_required: number;
  frequency: string;
  reset_type: string;
  description?: string | null;
}

export interface TemplateBenefits {
  credits: TemplateCredit[];
  bonus_categories: TemplateBonusCategory[];
  spend_thresholds: TemplateSpendThreshold[];
}

export interface CardTemplate {
  id: string;
  name: string;
  issuer: string;
  network: string | null;
  annual_fee: number | null;
  currency: string | null;
  benefits: TemplateBenefits | null;
  notes: string | null;
  tags: string[] | null;
  has_image: boolean;
  version_id: string | null;
  images: string[];
}

export interface TemplateVersionSummary {
  version_id: string;
  name: string;
  annual_fee: number | null;
  is_current: boolean;
}

export interface FiveTwentyFourData {
  count: number;
  status: "green" | "yellow" | "red";
  dropoff_dates: {
    card_id: number;
    card_name: string;
    open_date: string;
    dropoff_date: string;
  }[];
}

export interface CardCreate {
  profile_id: number;
  template_id?: string | null;
  template_version_id?: string | null;
  card_image?: string | null;
  card_name: string;
  last_digits?: string | null;
  issuer: string;
  network?: string | null;
  card_type: string;
  status?: string;
  open_date?: string | null;
  close_date?: string | null;
  annual_fee?: number | null;
  annual_fee_date?: string | null;
  credit_limit?: number | null;
  custom_notes?: string | null;
  custom_tags?: string[] | null;
  spend_reminder_enabled?: boolean;
  spend_requirement?: number | null;
  spend_deadline?: string | null;
  spend_reminder_notes?: string | null;
  signup_bonus_amount?: number | null;
  signup_bonus_type?: string | null;
  signup_bonus_earned?: boolean;
}

export interface CardEventCreate {
  event_type: string;
  event_date: string;
  description?: string | null;
  metadata_json?: Record<string, unknown> | null;
}

export interface CardEventUpdate {
  event_type?: string;
  event_date?: string;
  description?: string | null;
  metadata_json?: Record<string, unknown> | null;
}

export interface ExportEvent {
  event_type: string;
  event_date: string;
  description: string | null;
  metadata_json: Record<string, unknown> | null;
}

export interface ExportBenefit {
  benefit_name: string;
  benefit_amount: number;
  frequency: string;
  reset_type: string;
  benefit_type: string;
  from_template: boolean;
  retired: boolean;
  notes: string | null;
  amount_used: number;
  period_start: string | null;
}

export interface ExportBonus {
  bonus_source: string;
  event_id: number | null;
  bonus_amount: number | null;
  bonus_credit_amount: number | null;
  bonus_type: string | null;
  bonus_earned: boolean;
  bonus_missed: boolean;
  spend_requirement: number | null;
  spend_deadline: string | null;
  spend_reminder_enabled: boolean;
  spend_reminder_notes: string | null;
  description: string | null;
}

export interface ExportBonusCategory {
  category: string;
  multiplier: string;
  portal_only: boolean;
  cap: number | null;
  from_template: boolean;
}

export interface ExportCard {
  template_id: string | null;
  template_version_id: string | null;
  card_image: string | null;
  card_name: string;
  last_digits: string | null;
  issuer: string;
  network: string | null;
  card_type: string;
  status: string;
  open_date: string | null;
  close_date: string | null;
  annual_fee: number | null;
  annual_fee_date: string | null;
  credit_limit: number | null;
  custom_notes: string | null;
  custom_tags: string[] | null;
  spend_reminder_enabled: boolean;
  spend_requirement: number | null;
  spend_deadline: string | null;
  spend_reminder_notes: string | null;
  signup_bonus_amount: number | null;
  signup_bonus_type: string | null;
  signup_bonus_earned: boolean;
  events: ExportEvent[];
  benefits: ExportBenefit[];
  bonuses: ExportBonus[];
  bonus_categories: ExportBonusCategory[];
}

export interface ExportProfile {
  name: string;
  cards: ExportCard[];
}

export interface ExportData {
  version: number;
  exported_at: string;
  profiles: ExportProfile[];
  settings?: Record<string, string> | null;
}

export interface ImportResult {
  profiles_imported: number;
  cards_imported: number;
  events_imported: number;
  benefits_imported: number;
  bonuses_imported: number;
  bonus_categories_imported: number;
  cards_skipped: number;
}

export interface AppSettings {
  timezone?: string;
  server_timezone?: string;
}

// Auth & User types
export type AuthMode = "open" | "single_password" | "multi_user" | "multi_user_oauth";

export interface AuthModeResponse {
  auth_mode: AuthMode;
  registration_enabled: boolean;
  oauth_providers: { name: string; display_name: string }[];
}

export interface UserBrief {
  id: number;
  username: string;
  display_name: string | null;
  role: string;
}

export interface SetupStatus {
  setup_complete: boolean;
  has_existing_data: boolean;
}

export interface SetupCompleteRequest {
  auth_mode: AuthMode;
  admin_username?: string;
  admin_password?: string;
  admin_email?: string;
  admin_display_name?: string;
  registration_enabled?: boolean;
  oauth_provider_name?: string;
  oauth_client_id?: string;
  oauth_client_secret?: string;
}

export interface SetupCompleteResponse {
  success: boolean;
  auth_mode: string;
  access_token: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user: UserBrief;
}
