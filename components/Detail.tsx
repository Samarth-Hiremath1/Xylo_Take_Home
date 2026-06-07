"use client";

import { useState } from "react";
import type { ViewItem } from "@/lib/types";
import {
  activeFlags,
  CONFIDENCE_META,
  formatDate,
  formatMoney,
  INTENT_META,
  URGENCY_META,
} from "@/lib/format";
import { Badge } from "./badges";

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-line pt-5">
      <h3 className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-faint">
        {label}
      </h3>
      {children}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-faint">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{children}</dd>
    </div>
  );
}

export function Detail({ item }: { item: ViewItem }) {
  const [draft, setDraft] = useState(item.draft ?? "");
  const [copied, setCopied] = useState(false);

  const conf = CONFIDENCE_META[item.match.confidence];
  const intent = INTENT_META[item.intent];
  const urgency = URGENCY_META[item.urgency];
  const flags = activeFlags(item.flags);
  const client = item.match.client;
  const entities = item.entities;

  const leadSignals = item.match.signals.filter(
    (s) => !s.startsWith("gemini adjudication"),
  );
  const adjudicationSignal = item.match.signals.find((s) =>
    s.startsWith("gemini adjudication"),
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable — ignore */
    }
  };

  const entityChips: string[] = [
    ...entities.amounts,
    ...(entities.ein ? [`EIN ${entities.ein}`] : []),
    ...entities.invoiceRefs.map((r) => `inv ${r}`),
    ...entities.dates,
  ];

  return (
    <div className="animate-fade-in">
      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-faint">
            {item.email.id.replace("_", " ")}
          </p>
          <h2 className="mt-1 font-serif text-2xl leading-tight text-ink">
            {item.email.senderName || item.email.senderEmail || "Unknown sender"}
          </h2>
          <p className="mt-1 truncate font-mono text-xs text-muted">
            {item.email.from}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <Badge tone={urgency.tone} dot>
            {urgency.label} urgency
          </Badge>
          <Badge tone="neutral">{intent.label}</Badge>
          <Badge tone={conf.tone}>{conf.label}</Badge>
        </div>
      </div>

      {/* what they want */}
      <p className="mt-5 font-serif text-lg italic leading-snug text-ink">
        “{item.summary}”
      </p>
      {item.email.subject && (
        <p className="mt-2 text-sm text-muted">
          <span className="text-faint">Subject:</span> {item.email.subject}
        </p>
      )}

      <div className="mt-6 space-y-6">
        {/* needs-a-human callouts */}
        {flags.length > 0 && (
          <Section label="Why this needs attention">
            <ul className="space-y-2.5">
              {flags.map((f) => (
                <li key={f.key} className="flex gap-2.5">
                  <span
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                      f.tone === "danger"
                        ? "bg-danger"
                        : f.tone === "warn"
                          ? "bg-warn"
                          : "bg-faint"
                    }`}
                  />
                  <p className="text-sm leading-relaxed text-ink">
                    <span className="font-semibold">{f.label}.</span>{" "}
                    <span className="text-muted">{f.explain}</span>
                  </p>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* match explainability */}
        <Section label="How this was matched">
          <p className="text-sm text-muted">
            {client ? (
              <>
                Matched to{" "}
                <span className="font-semibold text-ink">
                  {client.name || "(no name on file)"}
                </span>{" "}
                <span className="font-mono text-xs text-faint">
                  #{client.clientId}
                </span>{" "}
                at{" "}
                <Badge tone={conf.tone} className="align-middle">
                  {conf.label}
                </Badge>
              </>
            ) : (
              <span className="text-danger-ink">
                No confident CRM match — review manually.
              </span>
            )}
          </p>
          <div className="mt-3 rounded-lg border border-line bg-paper/60 p-3">
            <p className="mb-2 font-mono text-[11px] text-faint">
              audit trail · matched via {leadSignals.join(" + ")}
            </p>
            <ul className="space-y-1.5">
              {item.match.signals.map((s, i) => (
                <li
                  key={i}
                  className="flex gap-2 font-mono text-xs leading-relaxed text-muted"
                >
                  <span className="text-ok">✓</span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>
          {adjudicationSignal && (
            <p className="mt-2 text-xs italic text-muted">
              A second opinion from the model was used because confidence was
              below high.
            </p>
          )}
        </Section>

        {/* CRM record */}
        <Section label="Matched CRM record">
          {item.crm ? (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
              <Field label="Name">{item.crm.name || "—"}</Field>
              <Field label="Company">{item.crm.company || "—"}</Field>
              <Field label="Status">
                <span className="capitalize">{item.crm.status}</span>
                {item.crm.statusUncertain && (
                  <span className="text-warn-ink"> (uncertain)</span>
                )}
              </Field>
              <Field label="Email">
                <span className="break-all font-mono text-xs">
                  {item.crm.email || "—"}
                </span>
              </Field>
              <Field label="Phone">
                <span className="font-mono">{item.crm.phone || "—"}</span>
              </Field>
              <Field label="Account value">
                <span className="nums">{formatMoney(item.crm.value)}</span>
              </Field>
              <Field label="Last contact">{formatDate(item.crm.lastContact)}</Field>
              <Field label="Client ID">
                <span className="font-mono">#{item.crm.clientId}</span>
              </Field>
              <div className="col-span-2 sm:col-span-3">
                <dt className="text-[11px] uppercase tracking-wide text-faint">
                  CRM notes
                </dt>
                <dd className="mt-0.5 text-sm italic text-muted">
                  {item.crm.notes ? `“${item.crm.notes}”` : "—"}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-muted">
              This email could not be tied to a CRM client with confidence.
            </p>
          )}
        </Section>

        {/* original email */}
        <Section label="Original email">
          <div className="rounded-lg border border-line bg-surface p-4">
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink">
              {item.email.body}
            </pre>
          </div>
          {entityChips.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] uppercase tracking-wide text-faint">
                Extracted
              </span>
              {entityChips.map((c, i) => (
                <span
                  key={i}
                  className="rounded-md bg-paper px-2 py-0.5 font-mono text-[11px] text-muted ring-1 ring-inset ring-line"
                >
                  {c}
                </span>
              ))}
            </div>
          )}
        </Section>

        {/* draft reply */}
        <Section label="Suggested reply">
          {item.reply_warranted && item.draft ? (
            <>
              <div className="mb-2 flex items-center justify-between">
                <Badge tone="warn">Draft — review before sending</Badge>
                <button
                  onClick={copy}
                  className="rounded-md px-2.5 py-1 text-xs font-medium text-brand-ink ring-1 ring-inset ring-brand/30 transition-colors hover:bg-brand-soft"
                >
                  {copied ? "Copied ✓" : "Copy"}
                </button>
              </div>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={Math.min(16, Math.max(7, draft.split("\n").length + 1))}
                spellCheck
                className="w-full resize-y rounded-lg border border-line bg-surface p-4 text-sm leading-relaxed text-ink shadow-inner outline-none transition-shadow focus:border-brand/40 focus:ring-2 focus:ring-brand/15"
              />
              <div className="mt-3 rounded-lg border-l-2 border-brand/40 bg-brand-soft/50 px-3 py-2">
                <p className="font-mono text-[11px] uppercase tracking-wide text-brand-ink/70">
                  Why this angle
                </p>
                <p className="mt-1 text-sm leading-relaxed text-brand-ink">
                  {item.draft_rationale}
                </p>
              </div>
              <p className="mt-2 text-[11px] text-faint">
                Edits stay on this screen only — nothing is sent or saved.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted">
              No reply needed. {item.draft_rationale}
            </p>
          )}
        </Section>
      </div>
    </div>
  );
}
