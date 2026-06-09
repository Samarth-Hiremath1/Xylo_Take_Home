// Identity Research Agent — runs a ReAct loop (reason -> act -> observe) over
// MCP tools to resolve a possibly-ambiguous sender to a CRM client.

import type { ParsedEmail } from "../types";
import type { ToolRegistry } from "./tools";
import type { IdentityResult, ReActState, Reasoner, TraceLogger } from "./types";

export class IdentityAgent {
  readonly name = "identity";

  constructor(
    private reasoner: Reasoner,
    private tools: ToolRegistry,
    private maxSteps = 6,
  ) {}

  async run(email: ParsedEmail, logger: TraceLogger): Promise<IdentityResult> {
    const state: ReActState = { email, steps: [] };

    for (let i = 0; i < this.maxSteps; i++) {
      const action = await this.reasoner.next(state);

      if (action.kind === "final") {
        logger.log("identity", action.thought, {
          clientId: action.result.clientId,
          confidence: action.result.confidence,
          resolvedVia: action.result.resolvedVia,
        });
        return action.result;
      }

      logger.log(
        "identity",
        `${action.thought} → ${action.tool}(${JSON.stringify(action.args)})`,
      );
      const observation = await this.tools.call(action.tool, action.args);
      state.steps.push({ action, observation });
    }

    logger.log("identity", "Reached max ReAct steps without resolution.");
    return {
      clientId: null,
      confidence: "none",
      isReferral: false,
      resolvedVia: "none",
      evidence: ["max steps reached"],
    };
  }
}
