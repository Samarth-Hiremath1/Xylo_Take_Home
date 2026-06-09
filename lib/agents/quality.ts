// Quality Agent — a lightweight review pass before anything surfaces to the
// owner. Deterministic checks here (cheap, auditable); a richer LLM critique can
// be layered in via a ModelClient without changing the interface.

import type { ParsedEmail } from "../types";
import type {
  DraftOutput,
  IdentityResult,
  QualityCheck,
  QualityReview,
  ReconciliationResult,
  TraceLogger,
} from "./types";

export interface QualityInput {
  email: ParsedEmail;
  identity: IdentityResult;
  reconciliation: ReconciliationResult;
  draft: DraftOutput;
}

const DISCREPANCY_LANGUAGE =
  /review|records|differ|confirm|unconfirmed|looking into|discrepan|verify/i;

export class QualityAgent {
  readonly name = "quality";

  async review(input: QualityInput, logger: TraceLogger): Promise<QualityReview> {
    const { identity, reconciliation, draft } = input;
    const text = draft.draft ?? "";
    const checks: QualityCheck[] = [];

    checks.push({
      name: "identity_resolved",
      pass: identity.clientId !== null,
      note: identity.clientId
        ? `Resolved to #${identity.clientId} (${identity.confidence}).`
        : "Sender could not be resolved to a CRM client.",
    });

    checks.push({
      name: "confidence_high",
      pass: identity.confidence === "high",
      note: `Match confidence is ${identity.confidence}.`,
    });

    if (reconciliation.verdict === "discrepancy_confirmed") {
      checks.push({
        name: "discrepancy_surfaced",
        pass: !!draft.draft && DISCREPANCY_LANGUAGE.test(text),
        note: draft.draft
          ? "Draft should surface the discrepancy, not confirm the client's figure."
          : "No draft to evaluate.",
      });
    }

    if (identity.isReferral) {
      checks.push({
        name: "referral_routed",
        pass: !!draft.draft && /refer|reach out|thank/i.test(text),
        note: "Referral replies should address the referrer, not the unverified client.",
      });
    }

    checks.push({
      name: "no_placeholder",
      pass: !text.includes("["),
      note: "Draft should contain no unfilled placeholders.",
    });

    // Money disputes and sub-high matches always want a human's eyes.
    const verdict: QualityReview["verdict"] =
      reconciliation.verdict === "discrepancy_confirmed" ||
      identity.confidence !== "high" ||
      checks.some((c) => !c.pass)
        ? "needs_human"
        : "approved";

    logger.log("quality", `Verdict: ${verdict}.`, {
      failed: checks.filter((c) => !c.pass).map((c) => c.name),
    });
    return { verdict, checks };
  }
}
