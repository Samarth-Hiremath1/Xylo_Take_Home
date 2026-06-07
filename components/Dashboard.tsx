"use client";

import { useEffect, useRef, useState } from "react";
import type { ReEngageItem, ViewItem } from "@/lib/types";
import {
  CONFIDENCE_META,
  formatDate,
  formatLongDate,
  INTENT_META,
  standoutFlags,
  URGENCY_META,
} from "@/lib/format";
import { Badge, Dot } from "./badges";
import { Detail } from "./Detail";

const URGENCY_RULE: Record<string, string> = {
  high: "border-l-danger",
  medium: "border-l-warn",
  low: "border-l-line",
};

function Stat({
  value,
  label,
  tone = "ink",
}: {
  value: number;
  label: string;
  tone?: "ink" | "danger" | "warn" | "brand";
}) {
  const color =
    tone === "danger" && value > 0
      ? "text-danger"
      : tone === "warn" && value > 0
        ? "text-warn"
        : tone === "brand" && value > 0
          ? "text-brand"
          : "text-ink";
  return (
    <div className="flex flex-col">
      <span className={`nums font-serif text-3xl leading-none ${color}`}>
        {value}
      </span>
      <span className="mt-2 font-mono text-[11px] uppercase tracking-[0.12em] text-faint">
        {label}
      </span>
    </div>
  );
}

function Row({
  item,
  active,
  onSelect,
  index,
}: {
  item: ViewItem;
  active: boolean;
  onSelect: () => void;
  index: number;
}) {
  const conf = CONFIDENCE_META[item.match.confidence];
  const urgency = URGENCY_META[item.urgency];
  const flags = standoutFlags(item.flags);
  const sender =
    item.email.senderName || item.email.senderEmail || "Unknown sender";
  // A matched row may have a blank CRM name (e.g. #1006, #1013) — that's still a
  // match, not "no match".
  const client = item.match.client;

  return (
    <button
      onClick={onSelect}
      style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}
      className={`animate-fade-up block w-full border-l-[3px] px-4 py-4 text-left transition-colors ${
        URGENCY_RULE[item.urgency]
      } ${active ? "bg-brand-soft/50" : "hover:bg-paper/70"}`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <Dot tone={urgency.tone} />
          <span className="truncate font-medium text-ink">{sender}</span>
        </span>
        <Badge tone={conf.tone} className="shrink-0">
          {conf.label}
        </Badge>
      </div>

      <p className="mt-1.5 line-clamp-2 font-serif text-[15px] leading-snug text-ink">
        {item.summary}
      </p>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[11px] text-faint">
          {client ? (
            <>
              → {client.name || "Unnamed client"}{" "}
              <span className="text-faint/70">#{client.clientId}</span>
            </>
          ) : (
            <span className="text-danger-ink">→ no match</span>
          )}
        </span>
        <span className="text-line">·</span>
        <span className="text-[11px] text-muted">
          {INTENT_META[item.intent].short}
        </span>
        {flags.map((f) => (
          <Badge key={f.key} tone={f.tone}>
            {f.label}
          </Badge>
        ))}
      </div>
    </button>
  );
}

function ReEngageCard({ item, index }: { item: ReEngageItem; index: number }) {
  return (
    <div
      style={{ animationDelay: `${index * 50}ms` }}
      className="animate-fade-up rounded-xl2 border border-line bg-surface p-5 shadow-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-serif text-lg leading-tight text-ink">
            {item.name || "(no name on file)"}
          </h3>
          {item.company && (
            <p className="text-sm text-muted">{item.company}</p>
          )}
        </div>
        <Badge tone={item.status === "churned" ? "warn" : "neutral"}>
          <span className="capitalize">{item.status}</span>
          {item.statusUncertain ? "?" : ""}
        </Badge>
      </div>
      <dl className="mt-4 flex gap-6 text-sm">
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-faint">
            Last contact
          </dt>
          <dd className="mt-0.5 text-ink">{formatDate(item.lastContact)}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-faint">
            Client ID
          </dt>
          <dd className="mt-0.5 font-mono text-ink">#{item.clientId}</dd>
        </div>
      </dl>
      {item.notes && (
        <p className="mt-3 border-t border-line pt-3 text-sm italic text-muted">
          “{item.notes}”
        </p>
      )}
      <p className="mt-3 text-sm text-brand-ink">
        No inbound email — reach out to re-engage.
      </p>
    </div>
  );
}

export function Dashboard({
  items,
  reEngage,
  generatedAt,
}: {
  items: ViewItem[];
  reEngage: ReEngageItem[];
  generatedAt: string;
}) {
  const [tab, setTab] = useState<"triage" | "reengage">("triage");
  const [selectedId, setSelectedId] = useState(items[0]?.email.id ?? "");
  const [today, setToday] = useState(() =>
    formatLongDate(new Date(generatedAt)),
  );
  const detailRef = useRef<HTMLDivElement>(null);

  // Always show the actual current date once mounted (the briefing is opened "today").
  useEffect(() => setToday(formatLongDate(new Date())), []);

  const selected = items.find((i) => i.email.id === selectedId) ?? items[0];

  const onSelect = (id: string) => {
    setSelectedId(id);
    if (window.matchMedia("(max-width: 1023px)").matches) {
      requestAnimationFrame(() =>
        detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    }
  };

  const counts = {
    triage: items.length,
    highUrgency: items.filter((i) => i.urgency === "high").length,
    needReview: items.filter((i) => i.flags.needs_review).length,
    reEngage: reEngage.length,
  };

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-6xl px-5 pb-20 sm:px-8">
        {/* masthead */}
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line py-7">
          <div className="flex items-center gap-3.5">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand font-serif text-lg text-paper shadow-card">
              mb
            </div>
            <div>
              <h1 className="font-serif text-xl leading-none text-ink">
                Morning Briefing
              </h1>
              <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-faint">
                Client triage · reconciled to CRM
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="font-serif text-base text-ink">{today}</p>
            <p className="mt-0.5 text-[11px] text-faint">
              Briefing generated{" "}
              {new Date(generatedAt).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </p>
          </div>
        </header>

        {/* stats */}
        <div className="grid grid-cols-2 gap-6 border-b border-line py-7 sm:grid-cols-4">
          <Stat value={counts.triage} label="Emails to triage" />
          <Stat value={counts.highUrgency} label="High urgency" tone="danger" />
          <Stat value={counts.needReview} label="Need review" tone="warn" />
          <Stat value={counts.reEngage} label="Re-engage" tone="brand" />
        </div>

        {/* tabs */}
        <div className="flex items-center gap-1 py-5">
          {(
            [
              ["triage", `Triage (${counts.triage})`],
              ["reengage", `Re-engage (${counts.reEngage})`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                tab === key
                  ? "bg-ink text-paper"
                  : "text-muted hover:bg-paper/70 hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "triage" ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(340px,40%)_1fr]">
            {/* list */}
            <div className="overflow-hidden rounded-xl2 border border-line bg-surface shadow-card">
              <div className="scroll-quiet max-h-[calc(100vh-2rem)] divide-y divide-line overflow-y-auto lg:max-h-[78vh]">
                {items.map((item, i) => (
                  <Row
                    key={item.email.id}
                    item={item}
                    index={i}
                    active={selected?.email.id === item.email.id}
                    onSelect={() => onSelect(item.email.id)}
                  />
                ))}
              </div>
            </div>

            {/* detail */}
            <div ref={detailRef} className="lg:sticky lg:top-6 lg:self-start">
              <div className="scroll-quiet max-h-[78vh] overflow-y-auto rounded-xl2 border border-line bg-surface p-6 shadow-panel sm:p-8">
                {selected ? (
                  <Detail key={selected.email.id} item={selected} />
                ) : (
                  <p className="text-muted">Select an email to review.</p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div>
            <p className="mb-5 max-w-2xl text-sm text-muted">
              These clients are in the CRM but sent nothing this cycle. Surfaced
              by the reverse pass so they don&apos;t slip through the cracks.
            </p>
            {reEngage.length > 0 ? (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {reEngage.map((item, i) => (
                  <ReEngageCard key={item.clientId} item={item} index={i} />
                ))}
              </div>
            ) : (
              <p className="text-muted">Nothing to re-engage. 🎉</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
