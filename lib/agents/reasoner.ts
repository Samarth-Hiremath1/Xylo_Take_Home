// Reasoners drive the Identity agent's ReAct loop: given the scratchpad so far,
// decide the next tool call or finalize. The default HeuristicReasoner is
// deterministic (no LLM); LlmReasoner is the production swap.

import type { CrmClient, ParsedEmail } from "../types";
import type {
  IdentityResult,
  ModelClient,
  ReActAction,
  ReActState,
  Reasoner,
} from "./types";

const REFERRAL_RE = /\brefer(r(al|ing|ed)?|s)?\b|\bnew client\b/i;

function isReferral(email: ParsedEmail): boolean {
  return REFERRAL_RE.test(`${email.subject} ${email.body}`);
}

function isClient(obs: unknown): obs is CrmClient {
  return !!obs && typeof obs === "object" && "clientId" in obs;
}

function evidenceFrom(state: ReActState): string[] {
  return state.steps.flatMap((s) => {
    if (s.action.kind !== "tool") return [];
    const o = isClient(s.observation)
      ? `client #${s.observation.clientId}`
      : s.observation == null
        ? "null"
        : JSON.stringify(s.observation);
    return [`${s.action.tool}(${JSON.stringify(s.action.args)}) ⇒ ${o}`];
  });
}

const final = (thought: string, result: IdentityResult): ReActAction => ({
  kind: "final",
  thought,
  result,
});
const tool = (
  thought: string,
  name: string,
  args: Record<string, unknown>,
): ReActAction => ({ kind: "tool", thought, tool: name, args });

/**
 * Deterministic ReAct policy that mirrors the matcher's tiers via tool calls:
 *   exact email -> body extraction -> phone rescue -> web search -> give up.
 */
export class HeuristicReasoner implements Reasoner {
  name = "heuristic";

  next(state: ReActState): ReActAction {
    const { email, steps } = state;
    const last = steps[steps.length - 1];

    if (!last) {
      return email.senderEmail
        ? tool(
            "Sender provided an address — try an exact CRM email match first.",
            "crm_lookup_email",
            { email: email.senderEmail },
          )
        : tool(
            "No sender address — extract contacts from the body.",
            "extract_body_contacts",
            { body: email.body, subject: email.subject },
          );
    }

    const lastTool = last.action.kind === "tool" ? last.action.tool : "";

    if (lastTool === "crm_lookup_email") {
      if (isClient(last.observation)) {
        return final("Exact sender-email match — sender is the client.", {
          clientId: last.observation.clientId,
          confidence: "high",
          isReferral: false,
          resolvedVia: "email",
          evidence: evidenceFrom(state),
        });
      }
      return tool(
        "Sender is not a known client — extract body contacts and check for a referral.",
        "extract_body_contacts",
        { body: email.body, subject: email.subject },
      );
    }

    if (lastTool === "extract_body_contacts") {
      const obs = last.observation as { phones?: string[] } | null;
      if (obs?.phones?.length) {
        return tool(
          "Body contains a phone number — try a CRM phone match (rescues blank-email rows).",
          "crm_lookup_phone",
          { phone: obs.phones[0] },
        );
      }
      return tool(
        "No phone in the body — fall back to a web search for the named contact.",
        "web_search",
        { query: email.body.slice(0, 120) },
      );
    }

    if (lastTool === "crm_lookup_phone") {
      const referral = isReferral(email);
      if (isClient(last.observation)) {
        return final(
          "Phone matched a CRM row the sender email could not — likely a referral.",
          {
            clientId: last.observation.clientId,
            confidence: referral ? "medium" : "medium-high",
            isReferral: referral,
            resolvedVia: "phone",
            evidence: evidenceFrom(state),
          },
        );
      }
      return tool("Phone not in CRM — try a web search.", "web_search", {
        query: email.body.slice(0, 120),
      });
    }

    // web_search (mock) or any dead end -> give up.
    return final("Could not resolve the sender to a CRM client.", {
      clientId: null,
      confidence: "none",
      isReferral: isReferral(email),
      resolvedVia: "none",
      evidence: evidenceFrom(state),
    });
  }
}

// ---------- production swap: LLM-driven ReAct ----------

function buildReActPrompt(
  state: ReActState,
  tools: { name: string; description: string }[],
): string {
  const toolList = tools.map((t) => `- ${t.name}: ${t.description}`).join("\n");
  const scratch = state.steps
    .map((s, i) =>
      s.action.kind === "tool"
        ? `Step ${i + 1}: ${s.action.thought}\n  Action: ${s.action.tool}(${JSON.stringify(
            s.action.args,
          )})\n  Observation: ${JSON.stringify(s.observation)}`
        : "",
    )
    .filter(Boolean)
    .join("\n");

  return [
    "Resolve the sender of this email to a CRM client using the available tools.",
    "Respond with a single JSON object matching the ReActAction shape:",
    '  {"kind":"tool","thought":"...","tool":"<name>","args":{...}}  OR',
    '  {"kind":"final","thought":"...","result":{"clientId":...,"confidence":"high|medium-high|medium|none","isReferral":bool,"resolvedVia":"email|phone|fuzzy|none","evidence":[...]}}',
    "",
    `Tools:\n${toolList}`,
    "",
    `From: ${state.email.fromRaw}`,
    `Subject: ${state.email.subject}`,
    `Body: ${state.email.body}`,
    "",
    scratch ? `Scratchpad so far:\n${scratch}` : "No steps taken yet.",
  ].join("\n");
}

export class LlmReasoner implements Reasoner {
  name = "llm";
  constructor(
    private model: ModelClient,
    private tools: { name: string; description: string }[],
  ) {}

  async next(state: ReActState): Promise<ReActAction> {
    const raw = await this.model.complete(buildReActPrompt(state, this.tools));
    try {
      return JSON.parse(raw) as ReActAction;
    } catch {
      return final("Model output was not valid JSON — aborting.", {
        clientId: null,
        confidence: "none",
        isReferral: isReferral(state.email),
        resolvedVia: "none",
        evidence: ["llm parse error"],
      });
    }
  }
}

/** Deterministic stand-in for a real LLM, so the framework runs offline. */
export class MockModelClient implements ModelClient {
  name = "mock";
  async complete(): Promise<string> {
    return "{}";
  }
}
