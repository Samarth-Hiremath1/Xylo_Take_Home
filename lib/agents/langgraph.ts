// LangGraph variant of the orchestrator. Same five agents, wired as a StateGraph
// instead of the hand-rolled Orchestrator — to show the framework maps cleanly
// onto LangGraph. The agent classes are reused unchanged.
//
//   START ──▶ identity ─┐
//         └─▶ triage  ──┴─▶ reconciliation ─▶ drafting ─▶ quality ─▶ END
//   (fan-out)            (fan-in)

import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

import type { CrmClient, ParsedEmail } from "../types";
import { createMockTools, ToolRegistry } from "./tools";
import { createMockSources } from "./sources";
import { HeuristicReasoner } from "./reasoner";
import { IdentityAgent } from "./identity";
import { ReconciliationAgent } from "./reconciliation";
import { DraftingAgent } from "./drafting";
import { QualityAgent } from "./quality";
import {
  EMPTY_ENTITIES,
  TraceLogger,
  type AgentRecord,
  type DraftFn,
  type DraftOutput,
  type IdentityResult,
  type LiveSources,
  type QualityReview,
  type Reasoner,
  type ReconciliationResult,
  type TraceEntry,
  type TriageProvider,
  type TriageRecord,
} from "./types";

// State shared across the graph. Single-writer channels use a last-value reducer;
// `trace` accumulates entries from every node.
const GraphState = Annotation.Root({
  email: Annotation<ParsedEmail>(),
  identity: Annotation<IdentityResult | null>({
    reducer: (_, b) => b,
    default: () => null,
  }),
  triage: Annotation<TriageRecord | null>({
    reducer: (_, b) => b,
    default: () => null,
  }),
  reconciliation: Annotation<ReconciliationResult | null>({
    reducer: (_, b) => b,
    default: () => null,
  }),
  draft: Annotation<DraftOutput | null>({
    reducer: (_, b) => b,
    default: () => null,
  }),
  quality: Annotation<QualityReview | null>({
    reducer: (_, b) => b,
    default: () => null,
  }),
  trace: Annotation<TraceEntry[]>({
    reducer: (a, b) => a.concat(b),
    default: () => [],
  }),
});

export interface LangGraphDeps {
  clients: CrmClient[];
  triageProvider: TriageProvider;
  draftFn: DraftFn;
  reasoner?: Reasoner;
  tools?: ToolRegistry;
  sources?: LiveSources;
  maxSteps?: number;
  concurrency?: number;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        results[i] = await fn(items[i]);
      }
    }),
  );
  return results;
}

export function buildEmailGraph(deps: LangGraphDeps) {
  const tools = deps.tools ?? createMockTools(deps.clients);
  const sources = deps.sources ?? createMockSources(deps.clients);
  const reasoner = deps.reasoner ?? new HeuristicReasoner();

  const identityAgent = new IdentityAgent(reasoner, tools, deps.maxSteps);
  const reconAgent = new ReconciliationAgent(sources);
  const draftAgent = new DraftingAgent(deps.draftFn);
  const qualityAgent = new QualityAgent();

  // Node names are suffixed `_agent` because LangGraph forbids a node sharing a
  // name with a state channel (identity, triage, ...).
  const app = new StateGraph(GraphState)
    .addNode("identity_agent", async (s) => {
      const logger = new TraceLogger();
      const identity = await identityAgent.run(s.email, logger);
      return { identity, trace: logger.entries };
    })
    .addNode("triage_agent", async (s) => {
      const logger = new TraceLogger();
      const triage = await deps.triageProvider(s.email.id);
      logger.log(
        "triage",
        triage ? `intent ${triage.intent} / urgency ${triage.urgency}` : "no triage record",
      );
      return { triage, trace: logger.entries };
    })
    .addNode("reconciliation_agent", async (s) => {
      if (!s.identity) throw new Error("reconciliation: identity not resolved");
      const logger = new TraceLogger();
      const reconciliation = await reconAgent.run(
        s.identity,
        s.triage?.entities ?? EMPTY_ENTITIES,
        logger,
      );
      return { reconciliation, trace: logger.entries };
    })
    .addNode("drafting_agent", async (s) => {
      if (!s.identity || !s.reconciliation)
        throw new Error("drafting: missing prerequisites");
      const logger = new TraceLogger();
      const draft = await draftAgent.run(
        {
          email: s.email,
          identity: s.identity,
          reconciliation: s.reconciliation,
          triage: s.triage,
        },
        logger,
      );
      return { draft, trace: logger.entries };
    })
    .addNode("quality_agent", async (s) => {
      if (!s.identity || !s.reconciliation || !s.draft)
        throw new Error("quality: missing prerequisites");
      const logger = new TraceLogger();
      const quality = await qualityAgent.review(
        {
          email: s.email,
          identity: s.identity,
          reconciliation: s.reconciliation,
          draft: s.draft,
        },
        logger,
      );
      return { quality, trace: logger.entries };
    })
    .addEdge(START, "identity_agent") // fan-out
    .addEdge(START, "triage_agent")
    .addEdge("identity_agent", "reconciliation_agent") // fan-in (waits for both)
    .addEdge("triage_agent", "reconciliation_agent")
    .addEdge("reconciliation_agent", "drafting_agent")
    .addEdge("drafting_agent", "quality_agent")
    .addEdge("quality_agent", END)
    .compile();

  async function processEmail(email: ParsedEmail): Promise<AgentRecord> {
    const out = await app.invoke({ email });
    if (!out.identity || !out.reconciliation || !out.draft || !out.quality)
      throw new Error(`graph did not complete for ${email.id}`);
    return {
      emailId: email.id,
      sender: email.senderName || email.senderEmail || "unknown",
      identity: out.identity,
      triage: out.triage,
      reconciliation: out.reconciliation,
      draft: out.draft,
      quality: out.quality,
      trace: out.trace,
    };
  }

  function run(emails: ParsedEmail[]): Promise<AgentRecord[]> {
    return mapLimit(emails, deps.concurrency ?? 4, processEmail);
  }

  return { app, processEmail, run };
}
