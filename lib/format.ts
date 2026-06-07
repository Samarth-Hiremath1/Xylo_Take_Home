// Pure presentation helpers + display metadata for the dashboard.
// No data fetching, no side effects — safe to unit-test.

import type {
  Confidence,
  Intent,
  ReconciliationFlags,
  Urgency,
} from "./types";

export type Tone = "ok" | "warn" | "danger" | "neutral" | "brand";

// ---------- draft greeting cleanup (pure post-processing) ----------

/**
 * When a draft greets an email address as if it were a name
 * (e.g. "Dear angryclient@protonmail.com," for a no-name CRM row),
 * replace that opening with a generic "Hello,". Leaves real-name greetings alone.
 */
export function cleanDraftGreeting(draft: string | null): string | null {
  if (!draft) return draft;
  return draft.replace(/^\s*Dear\s+[^\s,]+@[^\s,]+\s*,/, "Hello,");
}

// ---------- formatters ----------

export function formatMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${n.toLocaleString("en-US")}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatLongDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

// ---------- urgency ----------

export const URGENCY_RANK: Record<Urgency, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export const URGENCY_META: Record<Urgency, { label: string; tone: Tone }> = {
  high: { label: "High", tone: "danger" },
  medium: { label: "Medium", tone: "warn" },
  low: { label: "Low", tone: "neutral" },
};

// ---------- confidence ----------

export const CONFIDENCE_META: Record<
  Confidence,
  { label: string; tone: Tone }
> = {
  high: { label: "High confidence", tone: "ok" },
  "medium-high": { label: "Medium-high", tone: "brand" },
  medium: { label: "Medium", tone: "warn" },
  none: { label: "No match", tone: "danger" },
};

// ---------- intent ----------

export const INTENT_META: Record<Intent, { label: string; short: string }> = {
  billing_payment: { label: "Billing & payment", short: "Billing" },
  document_request: { label: "Document request", short: "Documents" },
  scheduling: { label: "Scheduling", short: "Scheduling" },
  onboarding_lead: { label: "Onboarding / lead", short: "New / lead" },
  complaint_followup: { label: "Complaint / follow-up", short: "Complaint" },
};

// ---------- flags ----------

interface FlagDef {
  key: keyof ReconciliationFlags;
  label: string;
  tone: Tone;
  explain: string;
}

// Ordered by how loudly each should call for a human (danger -> warn -> neutral).
const FLAG_DEFS: FlagDef[] = [
  {
    key: "contradicts_crm",
    label: "Contradicts CRM",
    tone: "danger",
    explain:
      "The client references a figure that conflicts with our records. Do not confirm their number — verify first.",
  },
  {
    key: "referenced_invoice_or_amount_not_in_crm",
    label: "Unverified amount",
    tone: "danger",
    explain:
      "An invoice or amount mentioned isn't in the CRM. Treat it as unconfirmed until checked.",
  },
  {
    key: "needs_review",
    label: "Needs review",
    tone: "warn",
    explain:
      "Match confidence is below high. Confirm the client's identity before sending anything.",
  },
  {
    key: "sender_is_referral_not_client",
    label: "Referral",
    tone: "warn",
    explain:
      "The sender is a referrer, not the client. The reply should go to the referrer, not the named client.",
  },
  {
    key: "status_churned_or_inactive",
    label: "Churned / inactive",
    tone: "warn",
    explain:
      "This client is churned or inactive. Use a re-engagement tone rather than business-as-usual.",
  },
  {
    key: "rescued_via_phone",
    label: "Phone-matched",
    tone: "neutral",
    explain:
      "Matched via a phone number in the email because the CRM row had no email address.",
  },
  {
    key: "unknown_sender",
    label: "Unknown sender",
    tone: "neutral",
    explain: "The sender's address isn't a known client email in the CRM.",
  },
];

export function activeFlags(flags: ReconciliationFlags): FlagDef[] {
  return FLAG_DEFS.filter((f) => flags[f.key]);
}

/** The subset that should visually stand out in the list (needs a human). */
export function standoutFlags(flags: ReconciliationFlags): FlagDef[] {
  return activeFlags(flags).filter(
    (f) => f.tone === "danger" || f.tone === "warn",
  );
}
