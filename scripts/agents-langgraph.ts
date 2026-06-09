// Same multi-agent pipeline, orchestrated with LangGraph (StateGraph) instead of
// the hand-rolled orchestrator. Reuses the exact agent classes. Offline + keyless
// (triage/drafts grounded in the committed briefing).
//
// Run: npm run agents:langgraph

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { parseCrmCsv, parseEmailFile } from "../lib/normalize";
import { briefingGrounding, buildEmailGraph } from "../lib/agents";
import type { AgentRecord } from "../lib/agents";
import type { Briefing } from "../lib/types";

const DATA = join(process.cwd(), "data");

async function main() {
  const clients = parseCrmCsv(readFileSync(join(DATA, "crm_export.csv"), "utf8"));
  const emails = readdirSync(join(DATA, "emails"))
    .filter((f) => f.endsWith(".txt"))
    .sort()
    .map((f) =>
      parseEmailFile(f.replace(/\.txt$/, ""), readFileSync(join(DATA, "emails", f), "utf8")),
    );
  const briefing = JSON.parse(
    readFileSync(join(DATA, "briefing.json"), "utf8"),
  ) as Briefing;
  const { triageProvider, draftFn } = briefingGrounding(briefing);

  const graph = buildEmailGraph({ clients, triageProvider, draftFn });
  const records = await graph.run(emails);

  writeFileSync(
    join(DATA, "agent_run_langgraph.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        engine: "langgraph",
        mode: "offline-mock",
        agents: ["orchestrator(StateGraph)", "identity", "triage", "reconciliation", "drafting", "quality"],
        records,
      },
      null,
      2,
    ),
  );

  const approved = records.filter((r) => r.quality.verdict === "approved").length;
  console.log(
    `\n[LangGraph] Processed ${records.length} emails · ${approved} auto-approved · ` +
      `${records.length - approved} routed to a human. Wrote data/agent_run_langgraph.json`,
  );

  const show = (r: AgentRecord) => {
    console.log(`\n========== ${r.emailId} — ${r.sender} ==========`);
    console.log(
      `IDENTITY: #${r.identity.clientId} (${r.identity.confidence}, via ${r.identity.resolvedVia}, referral=${r.identity.isReferral})`,
    );
    console.log(`RECONCILIATION: ${r.reconciliation.verdict}`);
    r.reconciliation.details.forEach((d) => console.log(`  - ${d}`));
    console.log(`QUALITY: ${r.quality.verdict}`);
    console.log("TRACE (graph order):");
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
