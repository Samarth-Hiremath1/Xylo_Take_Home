// RECONCILE — pure code. Combines deterministic match + enrichment into flags.

import type {
  CrmClient,
  Enrichment,
  MatchResult,
  ReconciliationFlags,
} from './types';

function toInt(s: string): number | null {
  const n = Number(s.replace(/[^0-9]/g, ''));
  return Number.isFinite(n) && s.replace(/[^0-9]/g, '').length ? n : null;
}

function crmHasNumber(client: CrmClient | null, n: number): boolean {
  if (!client) return false;
  if (client.value === n) return true;
  return !!client.notes && client.notes.replace(/[^0-9]/g, '').includes(String(n));
}

export function reconcile(
  match: MatchResult,
  client: CrmClient | null,
  enrichment: Enrichment,
): ReconciliationFlags {
  const refAmounts = enrichment.entities.amounts
    .map(toInt)
    .filter((n): n is number => n != null);
  const invoiceRefs = enrichment.entities.invoiceRefs;

  // Referenced invoice/amount that the CRM has no record of.
  const invoiceNotInCrm = invoiceRefs.some((ref) => {
    const digits = ref.replace(/[^0-9]/g, '');
    if (!digits) return false;
    const crmNotes = (client?.notes ?? '').replace(/[^0-9]/g, '');
    return !crmNotes.includes(digits);
  });
  const amountNotInCrm = refAmounts.some((a) => !crmHasNumber(client, a));
  const referenced_invoice_or_amount_not_in_crm =
    (invoiceRefs.length > 0 && invoiceNotInCrm) ||
    (refAmounts.length > 0 && amountNotInCrm);

  // A referenced amount conflicts with an existing CRM value (e.g. 2850 vs 2400).
  const contradicts_crm =
    client?.value != null && refAmounts.some((a) => a !== client.value);

  return {
    unknown_sender: !match.senderInCrm,
    status_churned_or_inactive:
      !!client && (client.status === 'churned' || client.status === 'inactive'),
    referenced_invoice_or_amount_not_in_crm,
    contradicts_crm,
    rescued_via_phone: match.rescuedViaPhone,
    sender_is_referral_not_client: match.senderIsReferral,
    needs_review: match.confidence !== 'high',
  };
}
