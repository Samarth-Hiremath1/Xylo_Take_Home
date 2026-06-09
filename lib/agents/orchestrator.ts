// Orchestrator Agent — routes each email, fans out the parallel agents, fans in
// their results, then runs the dependent stages and a final quality gate.
//
// Per email:
//   fan-out:  [ Identity (ReAct) ‖ Triage (intent/urgency/entities) ]
//   fan-in →  Reconciliation (needs identity + entities)
//          →  Drafting        (needs identity + reconciliation + triage)
//          →  Quality gate
// Emails are processed concurrently up to a configurable limit.

import type { ParsedEmail } from "../types";
import type { IdentityAgent } from "./identity";
import type { ReconciliationAgent } from "./reconciliation";
import type { DraftingAgent } from "./drafting";
import type { QualityAgent } from "./quality";
import {
  EMPTY_ENTITIES,
  TraceLogger,
  type AgentRecord,
  type TriageProvider,
} from "./types";

export interface OrchestratorDeps {
  identity: IdentityAgent;
  reconciliation: ReconciliationAgent;
  drafting: DraftingAgent;
  quality: QualityAgent;
  triageProvider: TriageProvider;
  concurrency?: number;
}

/** Run an async fn over items with a bounded concurrency. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export class Orchestrator {
  constructor(private deps: OrchestratorDeps) {}

  async processEmail(email: ParsedEmail): Promise<AgentRecord> {
    const logger = new TraceLogger();
    logger.log("orchestrator", `Routing ${email.id}; fanning out identity + triage.`);

    // Fan-out: identity resolution and triage run in parallel.
    const [identity, triage] = await Promise.all([
      this.deps.identity.run(email, logger),
      this.deps.triageProvider(email.id),
    ]);
    logger.log("orchestrator", "Fan-in complete; running reconciliation.", {
      clientId: identity.clientId,
      intent: triage?.intent,
    });

    // Dependent stages.
    const reconciliation = await this.deps.reconciliation.run(
      identity,
      triage?.entities ?? EMPTY_ENTITIES,
      logger,
    );
    const draft = await this.deps.drafting.run(
      { email, identity, reconciliation, triage },
      logger,
    );
    const quality = await this.deps.quality.review(
      { email, identity, reconciliation, draft },
      logger,
    );

    return {
      emailId: email.id,
      sender: email.senderName || email.senderEmail || "unknown",
      identity,
      triage,
      reconciliation,
      draft,
      quality,
      trace: logger.entries,
    };
  }

  async run(emails: ParsedEmail[]): Promise<AgentRecord[]> {
    const limit = this.deps.concurrency ?? 4;
    return mapLimit(emails, limit, (email) => this.processEmail(email));
  }
}
