// Multi-agent platform — shared contracts.
//
// This is the FRAMEWORK layer. Every external integration (LLM, MCP tools, live
// financial sources) is expressed as an interface so the default offline/mock
// implementations can be swapped for production ones without touching the agents
// or the orchestrator. The deterministic engine in ../normalize, ../matcher and
// ../reconcile is the groundwork these agents build on.

import type {
  Confidence,
  EnrichmentEntities,
  ParsedEmail,
  ReconciliationFlags,
} from "../types";

// ---------- MCP-style tool abstraction ----------

export interface Tool {
  name: string;
  description: string;
  call(args: Record<string, unknown>): Promise<unknown>;
}

// ---------- Identity Research (ReAct) ----------

export interface IdentityResult {
  clientId: string | null;
  confidence: Confidence;
  isReferral: boolean;
  resolvedVia: "email" | "phone" | "fuzzy" | "none";
  evidence: string[]; // human-readable ReAct trail
}

export type ReActAction =
  | {
      kind: "tool";
      thought: string;
      tool: string;
      args: Record<string, unknown>;
    }
  | { kind: "final"; thought: string; result: IdentityResult };

export interface ReActStep {
  action: ReActAction;
  observation?: unknown;
}

export interface ReActState {
  email: ParsedEmail;
  steps: ReActStep[];
}

export interface Reasoner {
  name: string;
  next(state: ReActState): Promise<ReActAction> | ReActAction;
}

// ---------- Reconciliation / live sources ----------

export interface InvoiceRecord {
  invoiceId: string;
  clientId: string;
  total: number;
  status: string;
}

export interface LiveSources {
  quickbooks: {
    getBalance(
      clientId: string,
    ): Promise<{ clientId: string; balance: number | null; source: string }>;
  };
  invoices: {
    lookupByRef(ref: string): Promise<InvoiceRecord | null>;
  };
}

export type ReconVerdict =
  | "clean"
  | "discrepancy_confirmed"
  | "unverifiable"
  | "not_applicable";

export interface ReconciliationResult {
  verdict: ReconVerdict;
  details: string[];
  checked: { source: string; query: string; result: string }[];
}

// ---------- Drafting ----------

export interface DraftOutput {
  draft: string | null;
  rationale: string;
}

export interface DraftContext {
  email: ParsedEmail;
  identity: IdentityResult;
  reconciliation: ReconciliationResult;
  triage: TriageRecord | null;
}

export type DraftFn = (ctx: DraftContext) => Promise<DraftOutput>;

// ---------- Quality ----------

export interface QualityCheck {
  name: string;
  pass: boolean;
  note: string;
}

export interface QualityReview {
  verdict: "approved" | "needs_human";
  checks: QualityCheck[];
}

// ---------- LLM abstraction (defaults are deterministic/offline) ----------

export interface ModelClient {
  name: string;
  complete(prompt: string): Promise<string>;
}

// ---------- Triage record (grounding from the existing briefing) ----------

export interface TriageRecord {
  intent: string;
  urgency: string;
  summary: string;
  entities: EnrichmentEntities;
  reply_warranted: boolean;
  flags: ReconciliationFlags;
}

export type TriageProvider = (emailId: string) => Promise<TriageRecord | null>;

// ---------- Trace ----------

export interface TraceEntry {
  agent: string;
  message: string;
  data?: unknown;
}

export class TraceLogger {
  readonly entries: TraceEntry[] = [];
  log(agent: string, message: string, data?: unknown): void {
    this.entries.push({ agent, message, data });
  }
}

// ---------- Assembled per-email output ----------

export interface AgentRecord {
  emailId: string;
  sender: string;
  identity: IdentityResult;
  triage: TriageRecord | null;
  reconciliation: ReconciliationResult;
  draft: DraftOutput;
  quality: QualityReview;
  trace: TraceEntry[];
}

export const EMPTY_ENTITIES: EnrichmentEntities = {
  amounts: [],
  ein: null,
  invoiceRefs: [],
  dates: [],
};
