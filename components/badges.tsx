import type { ReactNode } from "react";
import type { Tone } from "@/lib/format";

// Editorial "stamp" tags — squared, uppercase, hairline-bordered. Reads like a
// ledger annotation rather than a generic pill.
const TONE_CLASSES: Record<Tone, string> = {
  ok: "text-ok-ink border-ok/30 bg-ok-soft/70",
  warn: "text-warn-ink border-warn/35 bg-warn-soft/80",
  danger: "text-danger-ink border-danger/35 bg-danger-soft/80",
  brand: "text-brand-ink border-brand/30 bg-brand-soft/70",
  neutral: "text-muted border-line bg-transparent",
};

const DOT_CLASSES: Record<Tone, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
  brand: "bg-brand",
  neutral: "bg-faint",
};

export function Badge({
  tone = "neutral",
  children,
  dot = false,
  className = "",
}: {
  tone?: Tone;
  children: ReactNode;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[3px] border px-1.5 py-[2px] text-[10px] font-semibold uppercase leading-4 tracking-[0.06em] ${TONE_CLASSES[tone]} ${className}`}
    >
      {dot && <span className={`h-1 w-1 rounded-full ${DOT_CLASSES[tone]}`} />}
      {children}
    </span>
  );
}

/** A small square ledger-tick — a quiet urgency marker. */
export function Dot({ tone }: { tone: Tone }) {
  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rotate-45 rounded-[1px] ${DOT_CLASSES[tone]}`}
    />
  );
}
