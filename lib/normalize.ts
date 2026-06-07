// NORMALIZE — pure code, no LLM, unit-testable.
// Parses the messy CRM export and raw email From headers into clean structs.

import { createHash } from 'node:crypto';
import type { CanonicalStatus, CrmClient, ParsedEmail } from './types';

// ---------- field normalizers ----------

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim().toLowerCase();
  return t.length ? t : null;
}

/** Strip everything but digits. Returns null if no digits. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D+/g, '');
  return digits.length ? digits : null;
}

/** Last-10-digit form, for matching across "(952) 555-0177" / "612 555 0193" etc. */
export function phoneKey(raw: string | null | undefined): string | null {
  const d = normalizePhone(raw);
  if (!d) return null;
  return d.length > 10 ? d.slice(-10) : d;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * Parse the 6 observed date formats into ISO YYYY-MM-DD:
 *   2024-04-02 | 4/29/2024 | 05/01/24 | "Apr 10 2024" | 2024/04/22 | 4-25-2024
 * Returns null for blanks/unparseable values.
 */
export function parseDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;

  let m: RegExpMatchArray | null;

  // ISO: 2024-04-02
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)))
    return iso(+m[1], +m[2], +m[3]);

  // slash-ISO: 2024/04/22
  if ((m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/)))
    return iso(+m[1], +m[2], +m[3]);

  // M/D/YYYY: 4/29/2024
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)))
    return iso(+m[3], +m[1], +m[2]);

  // M/D/YY: 05/01/24
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/)))
    return iso(2000 + +m[3], +m[1], +m[2]);

  // M-D-YYYY: 4-25-2024
  if ((m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)))
    return iso(+m[3], +m[1], +m[2]);

  // text month: "Apr 10 2024"
  if ((m = s.match(/^([A-Za-z]{3,})\s+(\d{1,2})[,\s]+(\d{4})$/))) {
    const mon = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mon) return iso(+m[3], mon, +m[2]);
  }

  return null;
}

/**
 * Map the inconsistent CRM status vocabulary onto the canonical enum and flag
 * uncertainty (a trailing "?").
 * Mapping (rawStatus is always preserved on the client so nothing is lost):
 *   active/Active, onboarding   -> active
 *   prospect, negotiating, new  -> prospect
 *   lead                        -> lead
 *   churned                     -> churned
 *   inactive                    -> inactive
 */
export function normalizeStatus(raw: string | null | undefined): {
  status: CanonicalStatus;
  uncertain: boolean;
  raw: string;
} {
  const original = (raw ?? '').trim();
  const uncertain = /\?/.test(original);
  const key = original.toLowerCase().replace(/[?!.\s]+$/g, '').trim();

  const map: Record<string, CanonicalStatus> = {
    active: 'active',
    onboarding: 'active',
    prospect: 'prospect',
    negotiating: 'prospect',
    new: 'prospect',
    lead: 'lead',
    churned: 'churned',
    inactive: 'inactive',
  };

  return { status: map[key] ?? 'lead', uncertain, raw: original };
}

/** Trim; treat whitespace-only (e.g. row 1009's single space) as empty -> null. */
export function cleanText(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = raw.trim();
  return t.length ? t : null;
}

function parseValue(raw: string | null | undefined): number | null {
  const t = cleanText(raw);
  if (!t) return null;
  const n = Number(t.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// ---------- CSV ----------

/** Minimal RFC-4180-ish CSV parser: handles quoted fields, commas, "" escapes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // drop fully-empty trailing rows
  return rows.filter((r) => r.some((c) => c.trim().length > 0));
}

/** Parse the CRM CSV (header-driven) into normalized CrmClient[]. */
export function parseCrmCsv(text: string): CrmClient[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);

  const cId = idx('client_id');
  const cName = idx('name');
  const cCompany = idx('company');
  const cEmail = idx('email');
  const cPhone = idx('phone');
  const cStatus = idx('status');
  const cLast = idx('last_contact');
  const cValue = idx('value');
  const cNotes = idx('notes');

  return rows.slice(1).map((r) => {
    const get = (i: number) => (i >= 0 ? r[i] ?? '' : '');
    const status = normalizeStatus(get(cStatus));
    return {
      clientId: get(cId).trim(),
      name: cleanText(get(cName)),
      company: cleanText(get(cCompany)),
      email: normalizeEmail(get(cEmail)),
      phone: normalizePhone(get(cPhone)),
      status: status.status,
      rawStatus: status.raw,
      statusUncertain: status.uncertain,
      lastContact: parseDate(get(cLast)),
      rawLastContact: cleanText(get(cLast)),
      value: parseValue(get(cValue)),
      notes: cleanText(get(cNotes)),
    } satisfies CrmClient;
  });
}

// ---------- email From header ----------

/**
 * Parse all 3 observed From shapes:
 *   bare:           tina@brightpathbooks.com
 *   name <addr>:    marcy h <marcyholt88@gmail.com>
 *   quoted name:    "Delgado, Ray" <r.delgado@delgadohvac.net>
 */
export function parseFromHeader(raw: string): {
  email: string | null;
  name: string | null;
} {
  const s = (raw ?? '').trim();
  if (!s) return { email: null, name: null };

  const angle = s.match(/<([^>]+)>/);
  if (angle) {
    const email = normalizeEmail(angle[1]);
    const name = s.slice(0, angle.index).trim().replace(/^"|"$/g, '').trim();
    return { email, name: name.length ? name : null };
  }

  // bare address
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))
    return { email: normalizeEmail(s), name: null };

  // name only, no address
  return { email: null, name: s.replace(/^"|"$/g, '').trim() || null };
}

/** Parse a raw email file (From / Subject headers + body) into ParsedEmail. */
export function parseEmailFile(id: string, raw: string): ParsedEmail {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  let fromRaw = '';
  let subject = '';
  let bodyStart = 0;

  // headers run until the first blank line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') {
      bodyStart = i + 1;
      break;
    }
    const fm = line.match(/^From:\s*(.*)$/i);
    if (fm) fromRaw = fm[1].trim();
    const sm = line.match(/^Subject:\s*(.*)$/i);
    if (sm) subject = sm[1].trim();
    bodyStart = i + 1;
  }

  const body = lines.slice(bodyStart).join('\n').trim();
  const { email, name } = parseFromHeader(fromRaw);
  const contentHash = createHash('sha256').update(raw).digest('hex').slice(0, 12);

  return {
    id,
    fromRaw,
    senderEmail: email,
    senderName: name,
    subject,
    body,
    raw,
    contentHash,
  };
}
