// ENRICH — the ONLY LLM surface. Gemini is used for judgment, never joins.
//   (a) per-email structured extraction (intent, urgency, summary, entities)
//   (b) tie-break adjudication, called ONLY for sub-HIGH-confidence matches.
//
// Every result is cached to disk keyed by email id + content hash, so re-runs
// don't burn quota and the demo is reproducible. Simple exponential backoff
// handles free-tier 429s, plus a polite inter-call delay.

import { GoogleGenAI, Type } from '@google/genai';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  Adjudication,
  Confidence,
  CrmClient,
  DraftResult,
  Enrichment,
  ParsedEmail,
  ReconciliationFlags,
} from './types';

export const MODEL = 'gemini-2.5-flash-lite'; // cheapest current Flash; verified available

const CACHE_ROOT = join(process.cwd(), 'data', 'cache');
const ENRICH_DIR = join(CACHE_ROOT, 'enrich');
const ADJUDICATE_DIR = join(CACHE_ROOT, 'adjudicate');
const DRAFT_DIR = join(CACHE_ROOT, 'draft');

const MIN_CALL_GAP_MS = Number(process.env.GEMINI_MIN_GAP_MS ?? 4500);
const MAX_RETRIES = 5;

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey)
      throw new Error('GEMINI_API_KEY is not set (needed only on a cache miss).');
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

// ---------- rate limiting + retry ----------

let lastCallAt = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function statusOf(err: unknown): number | undefined {
  const e = err as { status?: number; message?: string };
  if (typeof e?.status === 'number') return e.status;
  const m = /\b(429|500|503)\b/.exec(e?.message ?? '');
  return m ? Number(m[1]) : undefined;
}

async function generateJson<T>(prompt: string, schema: object): Promise<T> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const gap = MIN_CALL_GAP_MS - (Date.now() - lastCallAt);
    if (gap > 0) await sleep(gap);
    try {
      lastCallAt = Date.now();
      const res = await getClient().models.generateContent({
        model: MODEL,
        contents: prompt,
        config: { responseMimeType: 'application/json', responseSchema: schema },
      });
      const text = res.text;
      if (!text) throw new Error('empty response from Gemini');
      return JSON.parse(text) as T;
    } catch (err) {
      const status = statusOf(err);
      const retriable = status === 429 || status === 500 || status === 503;
      if (!retriable || attempt === MAX_RETRIES) throw err;
      const backoff = Math.min(2000 * 2 ** attempt, 30_000);
      console.warn(
        `  [gemini] ${status} — retry ${attempt + 1}/${MAX_RETRIES} in ${backoff}ms`,
      );
      await sleep(backoff);
    }
  }
  throw new Error('unreachable');
}

// ---------- cache ----------

function readCache<T>(dir: string, key: string): T | null {
  const path = join(dir, `${key}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

function writeCache(dir: string, key: string, value: unknown): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${key}.json`), JSON.stringify(value, null, 2));
}

// ---------- (a) per-email enrichment ----------

const ENRICH_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    intent: {
      type: Type.STRING,
      enum: [
        'billing_payment',
        'document_request',
        'scheduling',
        'onboarding_lead',
        'complaint_followup',
      ],
    },
    urgency: { type: Type.STRING, enum: ['high', 'medium', 'low'] },
    summary: { type: Type.STRING },
    entities: {
      type: Type.OBJECT,
      properties: {
        amounts: { type: Type.ARRAY, items: { type: Type.STRING } },
        ein: { type: Type.STRING, nullable: true },
        invoiceRefs: { type: Type.ARRAY, items: { type: Type.STRING } },
        dates: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: ['amounts', 'invoiceRefs', 'dates'],
    },
    reply_warranted: { type: Type.BOOLEAN },
  },
  required: ['intent', 'urgency', 'summary', 'entities', 'reply_warranted'],
} as const;

function enrichPrompt(email: ParsedEmail): string {
  return [
    'You are triaging an inbound client email for an accounting/bookkeeping firm.',
    'Return ONLY the structured fields. Do not invent data not present in the email.',
    '',
    `From: ${email.fromRaw}`,
    `Subject: ${email.subject}`,
    '',
    email.body,
    '',
    'Fields:',
    '- intent: the single best category.',
    '- urgency: high if a hard/near deadline or escalation; low if "no rush"; else medium.',
    '- summary: one short line stating what the sender wants.',
    '- entities: amounts (as written), ein (or null), invoiceRefs, dates mentioned.',
    '- reply_warranted: true if this email needs a human response.',
  ].join('\n');
}

export async function enrichEmail(
  email: ParsedEmail,
): Promise<{ enrichment: Enrichment; fromCache: boolean }> {
  const key = `${email.id}.${email.contentHash}`;
  const cached = readCache<Enrichment>(ENRICH_DIR, key);
  if (cached) return { enrichment: cached, fromCache: true };

  const enrichment = await generateJson<Enrichment>(
    enrichPrompt(email),
    ENRICH_SCHEMA,
  );
  // normalize optional entity fields
  enrichment.entities = {
    amounts: enrichment.entities?.amounts ?? [],
    ein: enrichment.entities?.ein ?? null,
    invoiceRefs: enrichment.entities?.invoiceRefs ?? [],
    dates: enrichment.entities?.dates ?? [],
  };
  writeCache(ENRICH_DIR, key, enrichment);
  return { enrichment, fromCache: false };
}

// ---------- (b) tie-break adjudication (sub-HIGH matches only) ----------

const ADJUDICATE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    agree: { type: Type.BOOLEAN },
    confidence: { type: Type.STRING, enum: ['high', 'medium', 'low'] },
    reason: { type: Type.STRING },
  },
  required: ['agree', 'confidence', 'reason'],
} as const;

function adjudicatePrompt(
  email: ParsedEmail,
  candidate: CrmClient,
  signals: string[],
): string {
  return [
    'A deterministic matcher proposed (below HIGH confidence) that this email',
    'belongs to the following CRM client. Judge whether the match is correct.',
    '',
    `EMAIL From: ${email.fromRaw}`,
    `EMAIL Subject: ${email.subject}`,
    `EMAIL Body: ${email.body}`,
    '',
    'CANDIDATE CRM CLIENT:',
    `  client_id: ${candidate.clientId}`,
    `  name: ${candidate.name ?? '(blank)'}`,
    `  company: ${candidate.company ?? '(blank)'}`,
    `  email: ${candidate.email ?? '(blank)'}`,
    `  phone: ${candidate.phone ?? '(blank)'}`,
    `  notes: ${candidate.notes ?? '(blank)'}`,
    '',
    `Deterministic signals: ${signals.join('; ')}`,
    '',
    'Return agree (true/false), your confidence, and a one-line reason.',
  ].join('\n');
}

export async function adjudicateMatch(
  email: ParsedEmail,
  candidate: CrmClient,
  signals: string[],
): Promise<{ adjudication: Adjudication; fromCache: boolean }> {
  const key = `${email.id}.${email.contentHash}.c${candidate.clientId}`;
  const cached = readCache<Adjudication>(ADJUDICATE_DIR, key);
  if (cached) return { adjudication: cached, fromCache: true };

  const adjudication = await generateJson<Adjudication>(
    adjudicatePrompt(email, candidate, signals),
    ADJUDICATE_SCHEMA,
  );
  writeCache(ADJUDICATE_DIR, key, adjudication);
  return { adjudication, fromCache: false };
}

// ---------- (c) reply drafting (grounded in reconciliation flags) ----------

const DRAFT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    draft: { type: Type.STRING },
    draft_rationale: { type: Type.STRING },
  },
  required: ['draft', 'draft_rationale'],
} as const;

export interface DraftContext {
  confidence: Confidence;
  flags: ReconciliationFlags;
  client: CrmClient | null;
  enrichment: Enrichment;
}

function draftPrompt(email: ParsedEmail, ctx: DraftContext): string {
  const { confidence, flags, client, enrichment } = ctx;
  const belowHigh = confidence !== 'high';

  return [
    'You are drafting a reply on behalf of an accounting/bookkeeping firm to an',
    'inbound email. This is a DRAFT for human review — it will NOT be auto-sent.',
    '',
    'Hard rules (always):',
    '- Professional, concise, businesslike-but-warm.',
    '- NEVER commit the firm to any financial figure or action you cannot verify',
    "  from the firm's own records given below. Never repeat the client's quoted",
    '  number back as if it were confirmed fact.',
    '- Sign off generically (e.g. "Best regards, The Team") — do not invent a name.',
    '',
    'Reconciliation context — GROUND the draft in this, not just the email text:',
    `- Matched client: ${
      client
        ? `${client.name ?? '(no name)'} / ${client.company ?? '(no company)'} (status: ${client.status}${client.statusUncertain ? '?' : ''})`
        : '(unmatched / identity uncertain)'
    }`,
    `- Match confidence: ${confidence}${belowHigh ? ' (BELOW HIGH — be conservative)' : ''}`,
    `- Firm's recorded amount for this client: ${client?.value != null ? `$${client.value}` : '(none on file)'}`,
    `- Firm notes: ${client?.notes ?? '(none)'}`,
    `- Detected intent / urgency: ${enrichment.intent} / ${enrichment.urgency}`,
    '- Flags:',
    `    contradicts_crm = ${flags.contradicts_crm}`,
    `    referenced_invoice_or_amount_not_in_crm = ${flags.referenced_invoice_or_amount_not_in_crm}`,
    `    needs_review = ${flags.needs_review}`,
    `    sender_is_referral_not_client = ${flags.sender_is_referral_not_client}`,
    `    status_churned_or_inactive = ${flags.status_churned_or_inactive}`,
    '',
    'Apply these, in priority order:',
    '1. If contradicts_crm OR referenced_invoice_or_amount_not_in_crm: do NOT confirm',
    "   or echo the client's figure as correct. Acknowledge their message, note that",
    '   our records differ / the item is unconfirmed, and say we are reviewing it and/or',
    "   ask them to confirm. You MAY state the firm's own recorded amount (above) as our",
    "   record, but never validate the client's number.",
    '2. If sender_is_referral_not_client: the SENDER is a referrer, NOT the client.',
    '   Address the draft to the referrer (thank them; confirm we will reach out to the',
    '   named client). Do NOT write a reply to the client and do NOT assume unverified',
    '   client details. Append one line beginning "INTERNAL NOTE:" about reaching out to',
    '   the actual client.',
    '3. Else if needs_review or confidence below HIGH: keep it conservative and',
    '   non-committal — acknowledge receipt and say a team member will follow up, without',
    '   asserting unverified facts.',
    '4. If status_churned_or_inactive: use a re-engagement tone (reconnect / welcome back),',
    '   not business-as-usual.',
    '',
    'EMAIL:',
    `From: ${email.fromRaw}`,
    `Subject: ${email.subject}`,
    '',
    email.body,
    '',
    'Return:',
    '- draft: the full draft reply text (include the INTERNAL NOTE line if rule 2 applies).',
    '- draft_rationale: 1-2 sentences naming the governing flag/condition and the angle',
    '  taken (e.g. "flagged discrepancy rather than confirming the $2,850 amount").',
  ].join('\n');
}

export async function draftReply(
  email: ParsedEmail,
  ctx: DraftContext,
): Promise<{ draft: DraftResult; fromCache: boolean }> {
  const key = `${email.id}.${email.contentHash}`;
  const cached = readCache<DraftResult>(DRAFT_DIR, key);
  if (cached) return { draft: cached, fromCache: true };

  const draft = await generateJson<DraftResult>(draftPrompt(email, ctx), DRAFT_SCHEMA);
  writeCache(DRAFT_DIR, key, draft);
  return { draft, fromCache: false };
}
