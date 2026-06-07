// Headless reconciliation engine. Produces data/briefing.json. No UI.
//
//   normalize -> match (deterministic) -> enrich (Gemini, cached)
//             -> adjudicate sub-HIGH matches (Gemini, cached)
//             -> reconcile flags -> write briefing.json
//
// Run: npm run briefing

import { config } from 'dotenv';
config({ path: ['.env.local', '.env'] }); // load secrets before any Gemini call

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseCrmCsv, parseEmailFile } from '../lib/normalize';
import { matchAll, reverseUnmatched } from '../lib/matcher';
import { adjudicateMatch, enrichEmail, MODEL } from '../lib/enrich';
import { reconcile } from '../lib/reconcile';
import type {
  Briefing,
  BriefingItem,
  CrmClient,
  ReEngageItem,
} from '../lib/types';

const DATA_DIR = join(process.cwd(), 'data');
const EMAILS_DIR = join(DATA_DIR, 'emails');
const OUT = join(DATA_DIR, 'briefing.json');

async function main() {
  // 1. Load + normalize CRM.
  const clients = parseCrmCsv(readFileSync(join(DATA_DIR, 'crm_export.csv'), 'utf8'));
  const byId = new Map<string, CrmClient>(clients.map((c) => [c.clientId, c]));
  console.log(`Loaded ${clients.length} CRM rows.`);

  // 2. Load + parse emails.
  const emails = readdirSync(EMAILS_DIR)
    .filter((f) => f.endsWith('.txt'))
    .sort()
    .map((f) => parseEmailFile(f.replace(/\.txt$/, ''), readFileSync(join(EMAILS_DIR, f), 'utf8')));
  console.log(`Loaded ${emails.length} emails.`);

  // 3. Deterministic matching.
  const matches = matchAll(emails, clients);

  // 4-6. Enrich, adjudicate sub-HIGH, reconcile.
  const items: BriefingItem[] = [];
  let apiCalls = 0;

  for (const email of emails) {
    const match = matches.find((m) => m.emailId === email.id)!;
    const client = match.clientId ? byId.get(match.clientId) ?? null : null;

    const { enrichment, fromCache } = await enrichEmail(email);
    if (!fromCache) apiCalls++;
    console.log(
      `  enrich ${email.id}: ${enrichment.intent}/${enrichment.urgency}` +
        `${fromCache ? ' (cache)' : ' (api)'}`,
    );

    // Gemini tie-break adjudication ONLY for matches below HIGH confidence.
    let adjudication = null;
    const signals = [...match.signals];
    if (client && match.confidence !== 'high' && match.confidence !== 'none') {
      const res = await adjudicateMatch(email, client, match.signals);
      if (!res.fromCache) apiCalls++;
      adjudication = res.adjudication;
      signals.push(
        `gemini adjudication: ${adjudication.agree ? 'agree' : 'disagree'} ` +
          `(${adjudication.confidence}) — ${adjudication.reason}`,
      );
      console.log(
        `  adjudicate ${email.id} -> ${client.clientId}: ` +
          `${adjudication.agree ? 'agree' : 'disagree'}${res.fromCache ? ' (cache)' : ' (api)'}`,
      );
    }

    const flags = reconcile(match, client, enrichment);

    items.push({
      email: {
        id: email.id,
        from: email.fromRaw,
        senderEmail: email.senderEmail,
        senderName: email.senderName,
        subject: email.subject,
        body: email.body,
      },
      match: {
        clientId: match.clientId,
        confidence: match.confidence,
        signals,
        client: client
          ? {
              clientId: client.clientId,
              name: client.name,
              company: client.company,
              status: client.status,
              statusUncertain: client.statusUncertain,
            }
          : null,
        adjudication,
      },
      intent: enrichment.intent,
      urgency: enrichment.urgency,
      summary: enrichment.summary,
      entities: enrichment.entities,
      flags,
      reply_warranted: enrichment.reply_warranted,
    });
  }

  // 7. Reverse pass — CRM rows with no inbound email become re-engage items.
  const reEngage: ReEngageItem[] = reverseUnmatched(clients, matches).map((c) => ({
    clientId: c.clientId,
    name: c.name,
    company: c.company,
    status: c.status,
    statusUncertain: c.statusUncertain,
    lastContact: c.lastContact,
    notes: c.notes,
    reason:
      `no inbound email; status ${c.status}${c.statusUncertain ? '?' : ''}` +
      `, last contact ${c.lastContact ?? 'unknown'}` +
      (c.notes ? ` — ${c.notes}` : ''),
  }));

  // 8. Write briefing.json.
  const briefing: Briefing = {
    generatedAt: new Date().toISOString(),
    model: MODEL,
    counts: {
      emails: emails.length,
      matched: items.filter((i) => i.match.clientId).length,
      highConfidence: items.filter((i) => i.match.confidence === 'high').length,
      needsReview: items.filter((i) => i.flags.needs_review).length,
      reEngage: reEngage.length,
    },
    items,
    re_engage: reEngage,
  };
  writeFileSync(OUT, JSON.stringify(briefing, null, 2));
  console.log(
    `\nWrote ${OUT}\n  ${briefing.counts.matched}/${briefing.counts.emails} matched, ` +
      `${briefing.counts.highConfidence} high-confidence, ` +
      `${briefing.counts.needsReview} need review, ` +
      `${briefing.counts.reEngage} re-engage. (${apiCalls} live Gemini call(s))`,
  );

  // 9. Print the hard cases for verification.
  const show = (label: string, obj: unknown) =>
    console.log(`\n========== ${label} ==========\n${JSON.stringify(obj, null, 2)}`);
  show('email_02 (invoice dispute)', items.find((i) => i.email.id === 'email_02'));
  show('email_05 (referral rescue)', items.find((i) => i.email.id === 'email_05'));
  show('re_engage 1015 (Hank Olson)', reEngage.find((r) => r.clientId === '1015'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
