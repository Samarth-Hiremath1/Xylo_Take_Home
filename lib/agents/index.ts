// Platform factory + barrel. Wires the default offline/mock implementation:
// heuristic ReAct reasoner, mock MCP tools, mock live sources. Swap any piece
// (LlmReasoner + real ModelClient, real MCP servers, real QuickBooks) without
// touching the agents or the orchestrator.

import type { CrmClient } from "../types";
import { createMockTools, ToolRegistry } from "./tools";
import { createMockSources } from "./sources";
import { HeuristicReasoner } from "./reasoner";
import { IdentityAgent } from "./identity";
import { ReconciliationAgent } from "./reconciliation";
import { DraftingAgent } from "./drafting";
import { QualityAgent } from "./quality";
import { Orchestrator } from "./orchestrator";
import type { DraftFn, LiveSources, Reasoner, TriageProvider } from "./types";

export interface PlatformOptions {
  clients: CrmClient[];
  triageProvider: TriageProvider;
  draftFn: DraftFn;
  // Overridable for production:
  reasoner?: Reasoner;
  tools?: ToolRegistry;
  sources?: LiveSources;
  concurrency?: number;
  maxSteps?: number;
}

export function createPlatform(opts: PlatformOptions): Orchestrator {
  const tools = opts.tools ?? createMockTools(opts.clients);
  const sources = opts.sources ?? createMockSources(opts.clients);
  const reasoner = opts.reasoner ?? new HeuristicReasoner();

  return new Orchestrator({
    identity: new IdentityAgent(reasoner, tools, opts.maxSteps),
    reconciliation: new ReconciliationAgent(sources),
    drafting: new DraftingAgent(opts.draftFn),
    quality: new QualityAgent(),
    triageProvider: opts.triageProvider,
    concurrency: opts.concurrency,
  });
}

export * from "./types";
export { ToolRegistry, createMockTools } from "./tools";
export { createMockSources } from "./sources";
export { HeuristicReasoner, LlmReasoner, MockModelClient } from "./reasoner";
export { IdentityAgent } from "./identity";
export { ReconciliationAgent } from "./reconciliation";
export { DraftingAgent } from "./drafting";
export { QualityAgent } from "./quality";
export { Orchestrator } from "./orchestrator";
