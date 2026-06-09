// Mock "live" financial sources for the Reconciliation agent.
//
// In production these wrap the QuickBooks API and the firm's invoice system.
// The mock seeds balances from the CRM `value` column and a tiny invoice fixture
// so contradictions in the sample data (e.g. email_02) can be verdicted.

import type { CrmClient } from "../types";
import type { InvoiceRecord, LiveSources } from "./types";

// Seeded so invoice #4471 (email_02) resolves to Ray Delgado / $2,400 — the
// figure on file — letting the agent confirm the client's $2,850 is unsupported.
const INVOICE_FIXTURE: Record<string, InvoiceRecord> = {
  "4471": { invoiceId: "4471", clientId: "1002", total: 2400, status: "open" },
};

export function createMockSources(clients: CrmClient[]): LiveSources {
  const byId = new Map(clients.map((c) => [c.clientId, c]));

  return {
    quickbooks: {
      async getBalance(clientId) {
        const c = byId.get(clientId);
        return {
          clientId,
          balance: c?.value ?? null,
          source: "quickbooks",
        };
      },
    },
    invoices: {
      async lookupByRef(ref) {
        const key = ref.replace(/[^0-9]/g, "");
        return INVOICE_FIXTURE[key] ?? null;
      },
    },
  };
}
