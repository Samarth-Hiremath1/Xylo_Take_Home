import type { ReactNode } from "react";
import type { Tone } from "@/lib/format";

const TONE_CLASSES: Record<Tone, string> = {
  ok: "bg-ok-soft text-ok-ink ring-ok/20",
  warn: "bg-warn-soft text-warn-ink ring-warn/25",
  danger: "bg-danger-soft text-danger-ink ring-danger/25",
  brand: "bg-brand-soft text-brand-ink ring-brand/20",
  neutral: "bg-[#F0ECE2] text-muted ring-line",
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
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium leading-5 ring-1 ring-inset ${TONE_CLASSES[tone]} ${className}`}
    >
      {dot && (
        <span className={`h-1.5 w-1.5 rounded-full ${DOT_CLASSES[tone]}`} />
      )}
      {children}
    </span>
  );
}

/** A small colored dot — used as a quiet urgency marker. */
export function Dot({ tone }: { tone: Tone }) {
  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${DOT_CLASSES[tone]}`}
    />
  );
}
