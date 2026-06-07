import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  cleanText,
  normalizeEmail,
  normalizePhone,
  normalizeStatus,
  parseCrmCsv,
  parseDate,
  parseFromHeader,
} from '../lib/normalize';

test('normalizeEmail lowercases and trims', () => {
  assert.equal(normalizeEmail('  Marcy@Gmail.COM '), 'marcy@gmail.com');
  assert.equal(normalizeEmail(''), null);
});

test('normalizePhone strips to digits', () => {
  assert.equal(normalizePhone('(952) 555-0177'), '9525550177');
  assert.equal(normalizePhone('612 555 0193'), '6125550193');
  assert.equal(normalizePhone(''), null);
});

test('parseDate handles all 6 CRM formats', () => {
  assert.equal(parseDate('2024-04-02'), '2024-04-02'); // ISO
  assert.equal(parseDate('4/29/2024'), '2024-04-29'); // M/D/YYYY
  assert.equal(parseDate('05/01/24'), '2024-05-01'); // MM/DD/YY
  assert.equal(parseDate('Apr 10 2024'), '2024-04-10'); // text month
  assert.equal(parseDate('2024/04/22'), '2024-04-22'); // slash-ISO
  assert.equal(parseDate('4-25-2024'), '2024-04-25'); // M-D-YYYY
  assert.equal(parseDate(''), null);
  assert.equal(parseDate('not a date'), null);
});

test('normalizeStatus maps to canonical enum + uncertain flag', () => {
  assert.deepEqual(normalizeStatus('Active'), {
    status: 'active',
    uncertain: false,
    raw: 'Active',
  });
  assert.equal(normalizeStatus('churned?').status, 'churned');
  assert.equal(normalizeStatus('churned?').uncertain, true);
  assert.equal(normalizeStatus('onboarding').status, 'active');
  assert.equal(normalizeStatus('negotiating').status, 'prospect');
  assert.equal(normalizeStatus('lead').status, 'lead');
  assert.equal(normalizeStatus('inactive').status, 'inactive');
});

test('cleanText treats whitespace-only as empty (row 1009)', () => {
  assert.equal(cleanText(' '), null);
  assert.equal(cleanText('  paperwork  '), 'paperwork');
});

test('parseFromHeader handles all 3 shapes', () => {
  assert.deepEqual(parseFromHeader('marcy h <marcyholt88@gmail.com>'), {
    email: 'marcyholt88@gmail.com',
    name: 'marcy h',
  });
  assert.deepEqual(parseFromHeader('"Delgado, Ray" <r.delgado@delgadohvac.net>'), {
    email: 'r.delgado@delgadohvac.net',
    name: 'Delgado, Ray',
  });
  assert.deepEqual(parseFromHeader('tina@brightpathbooks.com'), {
    email: 'tina@brightpathbooks.com',
    name: null,
  });
});

test('parseCrmCsv normalizes a representative row', () => {
  const csv =
    'client_id,name,company,email,phone,status,last_contact,value,notes\n' +
    '1002,Ray Delgado,Delgado Heating & Air,r.delgado@delgadohvac.net,(952) 555-0177,Active,4/29/2024,2400,"invoice dispute open"\n' +
    '1009,Dwight S,Stella Roofing,dwight.s@stellaroofing.com,,active,,, \n';
  const rows = parseCrmCsv(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].phone, '9525550177');
  assert.equal(rows[0].lastContact, '2024-04-29');
  assert.equal(rows[0].value, 2400);
  assert.equal(rows[0].status, 'active');
  // row 1009: single-space notes => null
  assert.equal(rows[1].notes, null);
});
