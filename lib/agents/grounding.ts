// Shared grounding: turn the committed briefing.json into the triage + draft
// providers the agents consume. Pure (no fs) so it's reusable across runners.

import type { Briefing } from "../types";
import type { DraftFn, TriageProvider } from "./types";

export function briefingGrounding(briefing: Briefing): {
  triageProvider: TriageProvider;
  draftFn: DraftFn;
} {
  const byId = new Map(briefing.items.map((it) => [it.email.id, it]));

  const triageProvider: TriageProvider = async (id) => {
    const it = byId.get(id);
    return it
      ? {
          intent: it.intent,
          urgency: it.urgency,
          summary: it.summary,
          entities: it.entities,
          reply_warranted: it.reply_warranted,
          flags: it.flags,
        }
      : null;
  };

  const draftFn: DraftFn = async ({ email }) => {
    const it = byId.get(email.id);
    return {
      draft: it?.draft ?? null,
      rationale: it?.draft_rationale ?? "no draft on file",
    };
  };

  return { triageProvider, draftFn };
}
