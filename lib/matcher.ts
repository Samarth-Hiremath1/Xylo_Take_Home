// MATCHER — pure code, confidence-scored, records the signals used.
// Deterministic joins only. No LLM here.
//
// Tiers:
//   1. exact case-insensitive email match            -> high
//   2. digits-only phone match (body or sender)       -> medium-high
//   3. name + company fuzzy                            -> medium (risky)
// A match is down-ranked when the sender looks like a referral / third party
// rather than the client themselves (e.g. email_05).

import { phoneKey } from './normalize';
import type { Confidence, CrmClient, MatchResult, ParsedEmail } from './types';

const REFERRAL_RE = /\brefer(r(al|ing|ed)?|s)?\b|\bnew client\b|\breferring\b/i;

// ---------- extraction helpers ----------

/** Pull phone-like sequences from free text and return last-10-digit keys. */
export function extractBodyPhoneKeys(text: string): string[] {
  const out = new Set<string>();
  const re = /\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}/g;
  for (const m of text.matchAll(re)) {
    const k = phoneKey(m[0]);
    if (k && k.length === 10) out.add(k);
  }
  return [...out];
}

/** Integer amounts referenced in text (handles "2,400" and "2400"). */
export function extractAmounts(text: string): number[] {
  const out = new Set<number>();
  for (const m of text.matchAll(/\b\d{1,3}(?:,\d{3})+\b|\b\d{3,}\b/g)) {
    const n = Number(m[0].replace(/,/g, ''));
    if (Number.isFinite(n)) out.add(n);
  }
  return [...out];
}

/** EIN pattern NN-NNNNNNN. */
export function extractEins(text: string): string[] {
  return [...text.matchAll(/\b\d{2}-\d{7}\b/g)].map((m) => m[0]);
}

/** Recover an obfuscated address: "tom.becker at beckerroofing dot com". */
export function deobfuscateEmail(text: string): string | null {
  const m = text.match(
    /([a-z0-9._%+-]+)\s+at\s+([a-z0-9.-]+)\s+dot\s+([a-z]{2,})/i,
  );
  if (!m) return null;
  return `${m[1]}@${m[2]}.${m[3]}`.toLowerCase();
}

/** lowercase alphanumerics only — for loose company/domain comparison. */
function token(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ---------- indexes ----------

interface Indexes {
  byEmail: Map<string, CrmClient>;
  byPhone: Map<string, CrmClient>;
}

export function buildIndexes(clients: CrmClient[]): Indexes {
  const byEmail = new Map<string, CrmClient>();
  const byPhone = new Map<string, CrmClient>();
  for (const c of clients) {
    if (c.email) byEmail.set(c.email, c);
    const pk = phoneKey(c.phone);
    if (pk) byPhone.set(pk, c);
  }
  return { byEmail, byPhone };
}

// ---------- corroboration ----------

/** Signals that support an already-chosen match (do not change the tier). */
function corroborate(email: ParsedEmail, client: CrmClient): string[] {
  const signals: string[] = [];
  const hay = `${email.subject}\n${email.body}`;

  if (client.value != null && extractAmounts(hay).includes(client.value))
    signals.push(`value ${client.value} corroborates`);

  const bodyEins = extractEins(hay);
  if (bodyEins.length && client.notes) {
    const noteEins = extractEins(client.notes);
    const shared = bodyEins.find((e) => noteEins.includes(e));
    if (shared) signals.push(`EIN ${shared} in body corroborates CRM notes`);
  }

  const pk = phoneKey(client.phone);
  if (pk && extractBodyPhoneKeys(hay).includes(pk))
    signals.push('phone in body corroborates CRM phone');

  if (client.company) {
    const ct = token(client.company);
    const domain = email.senderEmail?.split('@')[1] ?? '';
    const deob = deobfuscateEmail(hay);
    const deobDomain = deob?.split('@')[1] ?? '';
    if (ct && (token(domain).includes(ct) || token(deobDomain).includes(ct)))
      signals.push(`company "${client.company}" corroborates email domain`);
  }

  return signals;
}

// ---------- fuzzy name/company ----------

function fuzzyNameCompany(
  email: ParsedEmail,
  clients: CrmClient[],
): CrmClient | null {
  const hay = `${email.senderName ?? ''}\n${email.subject}\n${email.body}`;
  const hayTok = token(hay);
  let best: CrmClient | null = null;

  for (const c of clients) {
    const companyTok = token(c.company);
    const nameTok = token(c.name);
    const companyHit = companyTok.length >= 4 && hayTok.includes(companyTok);
    const nameHit = nameTok.length >= 4 && hayTok.includes(nameTok);
    if (companyHit && nameHit) return c; // strong fuzzy: both name + company
    if ((companyHit || nameHit) && !best) best = c; // weak fuzzy fallback
  }
  return best;
}

// ---------- main ----------

export function matchEmail(
  email: ParsedEmail,
  clients: CrmClient[],
  indexes: Indexes,
): MatchResult {
  const hay = `${email.subject}\n${email.body}`;
  const senderInCrm = !!(email.senderEmail && indexes.byEmail.has(email.senderEmail));
  const looksReferral =
    !senderInCrm && REFERRAL_RE.test(`${email.subject} ${email.body}`);

  const base = (
    clientId: string | null,
    confidence: Confidence,
    signals: string[],
    extra: Partial<MatchResult> = {},
  ): MatchResult => ({
    emailId: email.id,
    clientId,
    confidence,
    signals,
    senderIsReferral: looksReferral,
    rescuedViaPhone: false,
    senderInCrm,
    ...extra,
  });

  // Tier 1 — exact sender-email match (sender is the client).
  if (email.senderEmail) {
    const c = indexes.byEmail.get(email.senderEmail);
    if (c) {
      const signals = ['email exact', ...corroborate(email, c)];
      return base(c.clientId, 'high', signals);
    }
  }

  // Tier 2 — phone match. Rescues blank-email CRM rows referenced in the body
  // (e.g. Tom Becker / 1005, reached via "612 555 0193").
  const phoneKeys = extractBodyPhoneKeys(hay);
  for (const pk of phoneKeys) {
    const c = indexes.byPhone.get(pk);
    if (c) {
      const signals = [
        `phone match (${pk}) on CRM row with no email`,
        ...corroborate(email, c),
      ];
      // base tier is medium-high; a referral context down-ranks to medium.
      const confidence: Confidence = looksReferral ? 'medium' : 'medium-high';
      if (looksReferral) signals.unshift('sender is a referral, not the client');
      return base(c.clientId, confidence, signals, { rescuedViaPhone: true });
    }
  }

  // Tier 3 — name + company fuzzy (risky).
  const fuzzy = fuzzyNameCompany(email, clients);
  if (fuzzy) {
    const signals = ['name/company fuzzy match (risky)', ...corroborate(email, fuzzy)];
    if (looksReferral) signals.unshift('sender is a referral, not the client');
    return base(fuzzy.clientId, 'medium', signals);
  }

  // No match.
  return base(null, 'none', ['no email/phone/name match in CRM']);
}

export function matchAll(
  emails: ParsedEmail[],
  clients: CrmClient[],
): MatchResult[] {
  const indexes = buildIndexes(clients);
  return emails.map((e) => matchEmail(e, clients, indexes));
}

/**
 * REVERSE pass: CRM clients with no inbound email become re-engage candidates,
 * so nobody is silently dropped (e.g. 1015 Hank Olson).
 */
export function reverseUnmatched(
  clients: CrmClient[],
  matches: MatchResult[],
): CrmClient[] {
  const matched = new Set(matches.map((m) => m.clientId).filter(Boolean) as string[]);
  return clients.filter((c) => !matched.has(c.clientId));
}
