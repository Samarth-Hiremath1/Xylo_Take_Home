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
  CrmClient,
  Enrichment,
  ParsedEmail,
} from './types';

export const MODEL = 'gemini-2.5-flash-lite'; // cheapest current Flash; verified available

const CACHE_ROOT = join(process.cwd(), 'data', 'cache');
const ENRICH_DIR = join(CACHE_ROOT, 'enrich');
const ADJUDICATE_DIR = join(CACHE_ROOT, 'adjudicate');

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
