// Server component: reads the committed briefing.json (no live Gemini calls),
// joins each item to its full CRM record, applies the pure greeting cleanup,
// sorts by urgency, and hands off to the UI.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import briefingData from "@/data/briefing.json";
import type { Briefing, CrmClient, ViewItem } from "@/lib/types";
import { parseCrmCsv } from "@/lib/normalize";
import { cleanDraftGreeting, URGENCY_RANK } from "@/lib/format";
import { Dashboard } from "@/components/Dashboard";

const briefing = briefingData as unknown as Briefing;

export default function Page() {
  // Full CRM records (deterministic parse, no API) for the detail view.
  const crmById = new Map<string, CrmClient>(
    parseCrmCsv(
      readFileSync(join(process.cwd(), "data", "crm_export.csv"), "utf8"),
    ).map((c) => [c.clientId, c]),
  );

  const items: ViewItem[] = briefing.items
    .map((it) => ({
      ...it,
      draft: cleanDraftGreeting(it.draft),
      crm: it.match.clientId ? crmById.get(it.match.clientId) ?? null : null,
    }))
    .sort((a, b) => {
      const u = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
      if (u !== 0) return u;
      // within an urgency band, surface the items that need a human first
      const r = Number(b.flags.needs_review) - Number(a.flags.needs_review);
      if (r !== 0) return r;
      return a.email.id.localeCompare(b.email.id);
    });

  return (
    <Dashboard
      items={items}
      reEngage={briefing.re_engage}
      generatedAt={briefing.generatedAt}
    />
  );
}
