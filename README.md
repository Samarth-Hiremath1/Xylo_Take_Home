# Morning Briefing

A morning-briefing tool that triages an accounting firm's client inbox: it reconciles
each inbound email against the CRM, flags what needs a human, and drafts grounded
replies — so the firm's owner can clear the morning's triage in one screen.

**Live demo:** https://xylo-take-home.vercel.app/

---

## Guided demo

1. **Open the app.** You land on the morning briefing — every inbound email sorted by
   urgency, with summary stats up top (emails to triage, high urgency, need review,
   re-engage).
2. **Click the invoice-dispute email** (Ray Delgado, "Question about invoice #4471").
   The tool catches that the client's **$2,850 figure contradicts the $2,400 on file**
   and that the **invoice isn't in the CRM** — so the draft reply surfaces the
   discrepancy instead of confirming the client's number.
3. **Click the Sandra Liu referral.** The sender isn't a client — she's referring
   someone. The tool **routes the reply to the referrer**, rescues the actual client
   (Tom Becker) via the phone number in the email body, and **flags him for review**
   because the match is below high confidence.
4. **Open the Re-engage tab** to see the reverse pass: CRM clients who sent nothing
   this cycle (e.g. Hank Olson) surfaced so they don't slip through the cracks.

---

## Run locally

```bash
git clone <this-repo>
cd Xylo_Take_Home
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). **No API key is needed to run the
app** — it renders the committed briefing.

## Run the tests

```bash
npm test
```

15 unit tests cover the pure logic (CRM/date/phone/status normalization, the email
matcher including the referral rescue, and the draft-greeting cleanup).

## Regenerate the briefing (optional)

The dashboard reads a committed `data/briefing.json`, so **the app runs with no key**.
You only need this step if you want to rebuild the briefing from the raw data.

```bash
# .env.local (gitignored)
GEMINI_API_KEY=your-gemini-api-key-here

npm run briefing
```

This writes `data/briefing.json`. Two honest caveats:

- **Caching means re-runs cost zero quota.** Every Gemini result is cached to
  `data/cache/` keyed by email id + content hash, so a re-run with the cache present
  makes **0 API calls**.
- **The free Gemini tier caps at ~20 requests/day** for `gemini-2.5-flash-lite`. A full
  cold regeneration (14 enrichments + 1 tie-break adjudication + ~14 draft replies)
  lands right at that ceiling — which is **exactly why the output is cached and
  committed**. Draft generation is also fault-tolerant: if a call hits the cap, that one
  draft is deferred (not fatal) and a later re-run fills it from cache.

---

## How it's built

- **Deterministic code does all the joins.** Normalization (emails, the 6 CRM date
  formats, phones, statuses) and the tiered, confidence-scored matcher are plain
  TypeScript — auditable, cheap, and fully reproducible. Every match records the signals
  that produced it (e.g. `email exact + value 2400 corroborates`), shown in the UI.
- **Gemini is used only for judgment** — intent, urgency, the one-line summary, reply
  drafting, and tie-break adjudication on sub-high-confidence matches. The LLM never
  performs a join. Drafts are grounded in the reconciliation flags (never confirm an
  unverified figure; route referrals to the referrer; re-engagement tone for churned
  clients).
- **Results are cached for reproducibility** (`data/cache/`), committed alongside the
  briefing so the demo is deterministic and keyless.
- **15 unit tests** cover the pure logic.

### Stack

Next.js 14 (App Router) · TypeScript · Tailwind CSS · `@google/genai`
(`gemini-2.5-flash-lite`). The UI is statically prerendered and makes **no live Gemini
calls** — it only reads the committed briefing, so it deploys to Vercel zero-config with
no environment variables.

### Pipeline

```
emails/*.txt + crm_export.csv
        │
   normalize.ts        pure: parse + clean both sides
        │
   matcher.ts          pure: tiered, confidence-scored joins (+ reverse pass)
        │
   enrich.ts           Gemini (cached): intent, summary, adjudication, drafts
        │
   reconcile.ts        pure: compute flags
        │
   data/briefing.json  ← committed; the UI renders this
```

---

## Multi-agent framework (forward path)

The batch pipeline above is the shipped product. `lib/agents/` adds the framework
for evolving it into a multi-agent platform, with each external integration (LLM,
MCP tools, live financial sources) behind an interface so the default offline/mock
implementation swaps cleanly for production.

```
Orchestrator        routes each email, fans out parallel agents, fans in results
  ├─ Identity        ReAct loop over MCP-style tools → resolves ambiguous senders
  ├─ Triage          intent / urgency / entities (grounded in the briefing)
  ├─ Reconciliation  queries live sources (QuickBooks, invoices) → verdicts contradictions
  ├─ Drafting        grounded reply from resolved identity + reconciliation
  └─ Quality         lightweight review gate before anything reaches the owner
```

Run it: `npm run agents` (offline, no key) → writes `data/agent_run.json` and prints
the full trace for email_02 (identity → live-source discrepancy `$2,850` vs `$2,400`
→ routed to a human) and email_05 (ReAct phone-rescue of a referral → flagged).
Swap points are typed: `Reasoner`/`ModelClient` (LLM-driven ReAct), `ToolRegistry`
(real MCP servers), `LiveSources` (real QuickBooks/invoice APIs).
