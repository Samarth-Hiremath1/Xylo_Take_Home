import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { parseCrmCsv, parseEmailFile } from '../lib/normalize';
import { matchAll, reverseUnmatched } from '../lib/matcher';
import type { MatchResult, ParsedEmail } from '../lib/types';

const DATA = join(process.cwd(), 'data');

function load() {
  const clients = parseCrmCsv(readFileSync(join(DATA, 'crm_export.csv'), 'utf8'));
  const emails: ParsedEmail[] = readdirSync(join(DATA, 'emails'))
    .filter((f) => f.endsWith('.txt'))
    .sort()
    .map((f) =>
      parseEmailFile(f.replace(/\.txt$/, ''), readFileSync(join(DATA, 'emails', f), 'utf8')),
    );
  const matches = matchAll(emails, clients);
  const byId = new Map(matches.map((m) => [m.emailId, m] as [string, MatchResult]));
  return { clients, emails, matches, byId };
}

test('email_01 exact-email match -> 1001, high', () => {
  const m = load().byId.get('email_01')!;
  assert.equal(m.clientId, '1001');
  assert.equal(m.confidence, 'high');
  assert.ok(m.signals.includes('email exact'));
});

test('email_02 corroborated by CRM value 2400', () => {
  const m = load().byId.get('email_02')!;
  assert.equal(m.clientId, '1002');
  assert.equal(m.confidence, 'high');
  assert.ok(m.signals.some((s) => s.includes('value 2400 corroborates')));
});

test('email_05 referral rescue -> 1005 via phone, medium, flagged', () => {
  const m = load().byId.get('email_05')!;
  assert.equal(m.clientId, '1005');
  assert.equal(m.confidence, 'medium');
  assert.equal(m.rescuedViaPhone, true);
  assert.equal(m.senderIsReferral, true);
  assert.equal(m.senderInCrm, false);
});

test('all 14 emails map to clients 1001..1014', () => {
  const { matches } = load();
  const ids = matches.map((m) => m.clientId).sort();
  const expected = Array.from({ length: 14 }, (_, i) => String(1001 + i)).sort();
  assert.deepEqual(ids, expected);
});

test('reverse pass surfaces 1015 (no inbound email)', () => {
  const { clients, matches } = load();
  const re = reverseUnmatched(clients, matches).map((c) => c.clientId);
  assert.deepEqual(re, ['1015']);
});
