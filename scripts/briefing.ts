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
import { adjudicateMatch, draftReply, enrichEmail, MODEL } from '../lib/enrich';
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
  let deferredDrafts = 0;

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

    // Reply drafting — only where a reply is warranted; grounded in the flags.
    let draft: string | null = null;
    let draft_rationale = 'No reply warranted; no draft generated.';
    if (enrichment.reply_warranted) {
      try {
        const res = await draftReply(email, {
          confidence: match.confidence,
          flags,
          client,
          enrichment,
        });
        if (!res.fromCache) apiCalls++;
        draft = res.draft.draft;
        draft_rationale = res.draft.draft_rationale;
        console.log(`  draft ${email.id}${res.fromCache ? ' (cache)' : ' (api)'}`);
      } catch (err) {
        // Don't let a quota/transient error discard the whole briefing — defer
        // this one draft and continue. Re-running once quota resets fills it in.
        draft = null;
        draft_rationale =
          'Reply warranted, but draft generation was deferred (Gemini error/quota). ' +
          'Re-run `npm run briefing` to generate it.';
        deferredDrafts++;
        console.warn(`  draft ${email.id} DEFERRED: ${String((err as Error).message).slice(0, 80)}`);
      }
    }

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
      draft,
      draft_rationale,
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
      `${briefing.counts.reEngage} re-engage. (${apiCalls} live Gemini call(s)` +
      `${deferredDrafts ? `, ${deferredDrafts} draft(s) deferred` : ''})`,
  );

  // 9. Print the draft edge cases for verification.
  const showDraft = (label: string, id: string) => {
    const it = items.find((i) => i.email.id === id)!;
    console.log(`\n========== ${label} ==========`);
    console.log(`confidence: ${it.match.confidence} | needs_review: ${it.flags.needs_review}`);
    console.log(
      `flags: contradicts_crm=${it.flags.contradicts_crm}, ` +
        `amount_not_in_crm=${it.flags.referenced_invoice_or_amount_not_in_crm}, ` +
        `referral=${it.flags.sender_is_referral_not_client}`,
    );
    console.log(`\n--- draft ---\n${it.draft ?? '(none)'}`);
    console.log(`\n--- draft_rationale ---\n${it.draft_rationale}`);
  };
  showDraft('email_02 — discrepancy case', 'email_02');
  showDraft('email_05 — low-confidence referral', 'email_05');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
