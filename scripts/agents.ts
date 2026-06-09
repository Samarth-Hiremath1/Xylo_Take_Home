// Runs the multi-agent platform over the sample emails and writes
// data/agent_run.json. Offline + reproducible: triage and drafts are grounded in
// the committed briefing.json (the existing Gemini outputs); identity, recon and
// quality run as live agents with the default mock tools/sources.
//
// Run: npm run agents

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { parseCrmCsv, parseEmailFile } from "../lib/normalize";
import { createPlatform } from "../lib/agents";
import type { AgentRecord, DraftFn, TriageRecord } from "../lib/agents";
import type { Briefing } from "../lib/types";

const DATA = join(process.cwd(), "data");

function loadEmails() {
  return readdirSync(join(DATA, "emails"))
    .filter((f) => f.endsWith(".txt"))
    .sort()
    .map((f) =>
      parseEmailFile(f.replace(/\.txt$/, ""), readFileSync(join(DATA, "emails", f), "utf8")),
    );
}

async function main() {
  const clients = parseCrmCsv(readFileSync(join(DATA, "crm_export.csv"), "utf8"));
  const emails = loadEmails();
  const briefing = JSON.parse(
    readFileSync(join(DATA, "briefing.json"), "utf8"),
  ) as Briefing;
  const byId = new Map(briefing.items.map((it) => [it.email.id, it]));

  // Triage + drafting are grounded in the committed briefing (the existing
  // enrich/draft Gemini outputs). In production these would be live agent calls.
  const triageProvider = async (id: string): Promise<TriageRecord | null> => {
    const it = byId.get(id);
    return it
      ? {
          intent: it.intent,
          urgency: it.urgency,
          summary: it.summary,
          entities: it.entities,
          reply_warranted: it.reply_warranted,
          flags: it.flags,
        }
      : null;
  };
  const draftFn: DraftFn = async ({ email }) => {
    const it = byId.get(email.id);
    return {
      draft: it?.draft ?? null,
      rationale: it?.draft_rationale ?? "no draft on file",
    };
  };

  const platform = createPlatform({ clients, triageProvider, draftFn });
  const records = await platform.run(emails);

  writeFileSync(
    join(DATA, "agent_run.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        mode: "offline-mock",
        agents: ["orchestrator", "identity", "reconciliation", "drafting", "quality"],
        records,
      },
      null,
      2,
    ),
  );

  const approved = records.filter((r) => r.quality.verdict === "approved").length;
  console.log(
    `\nProcessed ${records.length} emails · ${approved} auto-approved · ` +
      `${records.length - approved} routed to a human. Wrote data/agent_run.json`,
  );

  const show = (r: AgentRecord) => {
    console.log(`\n========== ${r.emailId} — ${r.sender} ==========`);
    console.log("IDENTITY:", JSON.stringify(r.identity, null, 2));
    console.log(`RECONCILIATION: ${r.reconciliation.verdict}`);
    r.reconciliation.details.forEach((d) => console.log(`  - ${d}`));
    r.reconciliation.checked.forEach((c) =>
      console.log(`  · ${c.source}: ${c.query} ⇒ ${c.result}`),
    );
    console.log(`QUALITY: ${r.quality.verdict}`);
    r.quality.checks.forEach((c) =>
      console.log(`  [${c.pass ? "✓" : "✗"}] ${c.name} — ${c.note}`),
    );
    console.log("TRACE:");
    r.trace.forEach((t) => console.log(`  (${t.agent}) ${t.message}`));
  };

  const r02 = records.find((r) => r.emailId === "email_02");
  const r05 = records.find((r) => r.emailId === "email_05");
  if (r02) show(r02);
  if (r05) show(r05);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
