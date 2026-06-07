// Shared types for the reconciliation engine.

export type CanonicalStatus =
  | 'active'
  | 'prospect'
  | 'lead'
  | 'churned'
  | 'inactive';

export interface CrmClient {
  clientId: string; // e.g. "1005" — reliable PK, never appears in emails
  name: string | null;
  company: string | null;
  email: string | null; // lowercased
  phone: string | null; // digits-only (normalized)
  status: CanonicalStatus; // mapped onto the canonical enum
  rawStatus: string; // original CRM string, preserved
  statusUncertain: boolean; // true when source had a trailing "?"
  lastContact: string | null; // ISO YYYY-MM-DD
  rawLastContact: string | null; // original date string, preserved
  value: number | null;
  notes: string | null; // trimmed; whitespace-only -> null
}

export interface ParsedEmail {
  id: string; // e.g. "email_05"
  fromRaw: string; // raw From header value
  senderEmail: string | null; // lowercased
  senderName: string | null;
  subject: string;
  body: string;
  raw: string; // full file contents
  contentHash: string; // sha256(raw), first 12 hex chars — cache key component
}

export type Confidence = 'high' | 'medium-high' | 'medium' | 'none';

export interface MatchResult {
  emailId: string;
  clientId: string | null;
  confidence: Confidence;
  signals: string[]; // human-readable signals that produced/support the match
  senderIsReferral: boolean; // sender is a third party, not the client
  rescuedViaPhone: boolean; // matched via body phone, not sender email
  senderInCrm: boolean; // sender address exists as a CRM client email
}

export type Intent =
  | 'billing_payment'
  | 'document_request'
  | 'scheduling'
  | 'onboarding_lead'
  | 'complaint_followup';

export type Urgency = 'high' | 'medium' | 'low';

export interface EnrichmentEntities {
  amounts: string[];
  ein: string | null;
  invoiceRefs: string[];
  dates: string[];
}

export interface Enrichment {
  intent: Intent;
  urgency: Urgency;
  summary: string; // one-line "what they want"
  entities: EnrichmentEntities;
  reply_warranted: boolean;
}

export interface Adjudication {
  agree: boolean; // does Gemini agree with the deterministic candidate match?
  confidence: Urgency; // high | medium | low (model's own read)
  reason: string;
}

export interface ReconciliationFlags {
  unknown_sender: boolean;
  status_churned_or_inactive: boolean;
  referenced_invoice_or_amount_not_in_crm: boolean;
  contradicts_crm: boolean;
  rescued_via_phone: boolean;
  sender_is_referral_not_client: boolean;
  needs_review: boolean;
}

export interface BriefingItem {
  email: {
    id: string;
    from: string;
    senderEmail: string | null;
    senderName: string | null;
    subject: string;
    body: string;
  };
  match: {
    clientId: string | null;
    confidence: Confidence;
    signals: string[];
    client: {
      clientId: string;
      name: string | null;
      company: string | null;
      status: CanonicalStatus;
      statusUncertain: boolean;
    } | null;
    adjudication: Adjudication | null; // only set for sub-HIGH matches
  };
  intent: Intent;
  urgency: Urgency;
  summary: string;
  entities: EnrichmentEntities;
  flags: ReconciliationFlags;
  reply_warranted: boolean;
}

export interface ReEngageItem {
  clientId: string;
  name: string | null;
  company: string | null;
  status: CanonicalStatus;
  statusUncertain: boolean;
  lastContact: string | null;
  notes: string | null;
  reason: string;
}

export interface Briefing {
  generatedAt: string;
  model: string;
  counts: {
    emails: number;
    matched: number;
    highConfidence: number;
    needsReview: number;
    reEngage: number;
  };
  items: BriefingItem[];
  re_engage: ReEngageItem[];
}
