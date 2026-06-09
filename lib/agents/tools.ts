// MCP-style tool registry + mock tools for the Identity Research agent.
//
// In production each tool is backed by a real MCP server (a CRM connector, a
// phone/identity provider, a web-search server). Here they're local mocks over
// the existing deterministic helpers so the ReAct loop runs offline.

import { phoneKey } from "../normalize";
import { deobfuscateEmail, extractBodyPhoneKeys } from "../matcher";
import type { CrmClient } from "../types";
import type { Tool } from "./types";

const REFERRAL_RE = /\brefer(r(al|ing|ed)?|s)?\b|\bnew client\b/i;

export class ToolRegistry {
  private map = new Map<string, Tool>();

  register(tool: Tool): this {
    this.map.set(tool.name, tool);
    return this;
  }

  get(name: string): Tool {
    const tool = this.map.get(name);
    if (!tool) throw new Error(`unknown tool: ${name}`);
    return tool;
  }

  list(): { name: string; description: string }[] {
    return [...this.map.values()].map((t) => ({
      name: t.name,
      description: t.description,
    }));
  }

  call(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.get(name).call(args);
  }
}

export function createMockTools(clients: CrmClient[]): ToolRegistry {
  return new ToolRegistry()
    .register({
      name: "crm_lookup_email",
      description: "Find a CRM client by exact (lowercased) email address.",
      async call(args) {
        const email = String(args.email ?? "").toLowerCase();
        return clients.find((c) => c.email === email) ?? null;
      },
    })
    .register({
      name: "crm_lookup_phone",
      description:
        "Find a CRM client by phone number (matched on the last 10 digits).",
      async call(args) {
        const key = phoneKey(String(args.phone ?? ""));
        if (!key) return null;
        return clients.find((c) => phoneKey(c.phone) === key) ?? null;
      },
    })
    .register({
      name: "extract_body_contacts",
      description:
        "Extract phone numbers, a de-obfuscated email, and a referral signal from email text.",
      async call(args) {
        const text = `${String(args.subject ?? "")}\n${String(args.body ?? "")}`;
        const deob = deobfuscateEmail(text);
        return {
          phones: extractBodyPhoneKeys(text),
          emails: deob ? [deob] : [],
          isReferral: REFERRAL_RE.test(text),
        };
      },
    })
    .register({
      name: "web_search",
      description:
        "Search the public web for a named person/company (mock; wire to a real MCP search server in production).",
      async call() {
        return { results: [] as unknown[] };
      },
    });
}
