// Drafting Agent — produces a grounded reply from the resolved identity and the
// reconciliation verdict. The actual generation is an injected DraftFn: the
// offline default returns the committed Gemini drafts; the production swap is the
// cached Gemini draftReply in ../enrich.

import type {
  DraftContext,
  DraftFn,
  DraftOutput,
  TraceLogger,
} from "./types";

export class DraftingAgent {
  readonly name = "drafting";

  constructor(private draftFn: DraftFn) {}

  async run(ctx: DraftContext, logger: TraceLogger): Promise<DraftOutput> {
    if (ctx.triage && !ctx.triage.reply_warranted) {
      logger.log("drafting", "No reply warranted — skipping draft.");
      return { draft: null, rationale: "No reply warranted; no draft generated." };
    }

    const out = await this.draftFn(ctx);

    // Surface the reconciliation verdict in the rationale so the draft is
    // explicitly grounded in it.
    const rationale =
      ctx.reconciliation.verdict === "discrepancy_confirmed"
        ? `${out.rationale} (Reconciliation confirmed a discrepancy — draft must not confirm the client's figure.)`
        : out.rationale;

    logger.log(
      "drafting",
      out.draft ? "Generated grounded draft." : "No draft produced.",
      { identity: ctx.identity.clientId, verdict: ctx.reconciliation.verdict },
    );
    return { draft: out.draft, rationale };
  }
}
