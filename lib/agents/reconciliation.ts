// Reconciliation Agent — queries live sources (QuickBooks, invoice system) to
// verdict whether amounts/invoices referenced in an email are supported by the
// firm's systems of record, or are a confirmed discrepancy.

import type { EnrichmentEntities } from "../types";
import type {
  IdentityResult,
  LiveSources,
  ReconciliationResult,
  TraceLogger,
} from "./types";

function toInt(s: string): number | null {
  const digits = s.replace(/[^0-9]/g, "");
  return digits ? Number(digits) : null;
}

const money = (n: number) => `$${n.toLocaleString("en-US")}`;

export class ReconciliationAgent {
  readonly name = "reconciliation";

  constructor(private sources: LiveSources) {}

  async run(
    identity: IdentityResult,
    entities: EnrichmentEntities,
    logger: TraceLogger,
  ): Promise<ReconciliationResult> {
    if (!identity.clientId) {
      return {
        verdict: "not_applicable",
        details: ["No resolved client to reconcile against."],
        checked: [],
      };
    }

    const amounts = entities.amounts
      .map(toInt)
      .filter((n): n is number => n != null);
    const refs = entities.invoiceRefs;

    if (!amounts.length && !refs.length) {
      return {
        verdict: "not_applicable",
        details: ["No amounts or invoice references in the email."],
        checked: [],
      };
    }

    const checked: ReconciliationResult["checked"] = [];

    // QuickBooks balance.
    const bal = await this.sources.quickbooks.getBalance(identity.clientId);
    checked.push({
      source: "quickbooks",
      query: `balance ${identity.clientId}`,
      result: bal.balance != null ? money(bal.balance) : "none",
    });

    // Invoice system lookups.
    const supported = new Set<number>();
    if (bal.balance != null) supported.add(bal.balance);
    for (const ref of refs) {
      const inv = await this.sources.invoices.lookupByRef(ref);
      checked.push({
        source: "invoice_system",
        query: `lookup ${ref}`,
        result: inv ? `#${inv.invoiceId} ${money(inv.total)} ${inv.status}` : "not found",
      });
      if (inv) supported.add(inv.total);
    }

    logger.log("reconciliation", "Queried live sources.", { checked });

    if (supported.size === 0) {
      return {
        verdict: "unverifiable",
        details: ["Live sources returned no figure to compare against."],
        checked,
      };
    }

    const unsupported = amounts.filter((a) => !supported.has(a));
    if (unsupported.length) {
      return {
        verdict: "discrepancy_confirmed",
        details: [
          `Client references ${unsupported.map(money).join(", ")}, ` +
            `unsupported by live sources (${[...supported].map(money).join(", ")}). ` +
            `Do not confirm the client's figure.`,
        ],
        checked,
      };
    }

    return {
      verdict: "clean",
      details: ["All referenced amounts match the live sources of record."],
      checked,
    };
  }
}
