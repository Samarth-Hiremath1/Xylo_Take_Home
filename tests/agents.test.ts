import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { parseCrmCsv, parseEmailFile } from "../lib/normalize";
import {
  createMockSources,
  createMockTools,
  HeuristicReasoner,
  IdentityAgent,
  QualityAgent,
  ReconciliationAgent,
  TraceLogger,
} from "../lib/agents";
import type { EnrichmentEntities, ParsedEmail } from "../lib/types";

const DATA = join(process.cwd(), "data");

function load() {
  const clients = parseCrmCsv(readFileSync(join(DATA, "crm_export.csv"), "utf8"));
  const emails: ParsedEmail[] = readdirSync(join(DATA, "emails"))
    .filter((f) => f.endsWith(".txt"))
    .sort()
    .map((f) =>
      parseEmailFile(f.replace(/\.txt$/, ""), readFileSync(join(DATA, "emails", f), "utf8")),
    );
  return { clients, emails };
}

const entities = (e: Partial<EnrichmentEntities>): EnrichmentEntities => ({
  amounts: [],
  ein: null,
  invoiceRefs: [],
  dates: [],
  ...e,
});

test("identity agent resolves an exact sender via the ReAct loop", async () => {
  const { clients, emails } = load();
  const agent = new IdentityAgent(new HeuristicReasoner(), createMockTools(clients));
  const e01 = emails.find((e) => e.id === "email_01")!;
  const r = await agent.run(e01, new TraceLogger());
  assert.equal(r.clientId, "1001");
  assert.equal(r.confidence, "high");
  assert.equal(r.resolvedVia, "email");
});

test("identity agent rescues the referral (email_05) via phone + flags it", async () => {
  const { clients, emails } = load();
  const agent = new IdentityAgent(new HeuristicReasoner(), createMockTools(clients));
  const e05 = emails.find((e) => e.id === "email_05")!;
  const r = await agent.run(e05, new TraceLogger());
  assert.equal(r.clientId, "1005");
  assert.equal(r.confidence, "medium");
  assert.equal(r.resolvedVia, "phone");
  assert.equal(r.isReferral, true);
});

test("reconciliation agent confirms the invoice discrepancy (email_02)", async () => {
  const { clients } = load();
  const agent = new ReconciliationAgent(createMockSources(clients));
  const r = await agent.run(
    { clientId: "1002", confidence: "high", isReferral: false, resolvedVia: "email", evidence: [] },
    entities({ amounts: ["2,400", "2,850"], invoiceRefs: ["4471"] }),
    new TraceLogger(),
  );
  assert.equal(r.verdict, "discrepancy_confirmed");
  assert.ok(r.checked.some((c) => c.source === "invoice_system"));
});

test("quality agent routes a confirmed discrepancy to a human", async () => {
  const agent = new QualityAgent();
  const review = await agent.review(
    {
      email: { id: "email_02" } as ParsedEmail,
      identity: { clientId: "1002", confidence: "high", isReferral: false, resolvedVia: "email", evidence: [] },
      reconciliation: {
        verdict: "discrepancy_confirmed",
        details: [],
        checked: [],
      },
      draft: { draft: "We are reviewing our records and will confirm.", rationale: "" },
    },
    new TraceLogger(),
  );
  assert.equal(review.verdict, "needs_human");
});
