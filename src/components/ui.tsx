import type { ReactNode } from "react";
import type { ChangeImpact } from "../api";

const impactMeta: Record<ChangeImpact, { label: string; text: string; bg: string; ring: string }> = {
  BREAKING: { label: "Breaking", text: "text-rose", bg: "bg-rose-soft", ring: "ring-rose/30" },
  DEPRECATION: { label: "Deprecation", text: "text-amber", bg: "bg-amber-soft", ring: "ring-amber/30" },
  NEW_FEATURE: { label: "New feature", text: "text-emerald", bg: "bg-emerald-soft", ring: "ring-emerald/30" },
};

export function ImpactChip({ impact }: { impact: ChangeImpact }) {
  const m = impactMeta[impact];
  return (
    <span className={`chip ${m.bg} ${m.text} ring-1 ring-inset ${m.ring}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-90" />
      {m.label}
    </span>
  );
}

export function Chip({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "sky" | "rose" | "amber" | "emerald" | "violet";
}) {
  const tones: Record<string, string> = {
    neutral: "bg-white/[0.05] text-content-muted ring-1 ring-inset ring-line",
    accent: "bg-accent-soft text-accent ring-1 ring-inset ring-accent/30",
    sky: "bg-sky-soft text-sky ring-1 ring-inset ring-sky/30",
    rose: "bg-rose-soft text-rose ring-1 ring-inset ring-rose/30",
    amber: "bg-amber-soft text-amber ring-1 ring-inset ring-amber/30",
    emerald: "bg-emerald-soft text-emerald ring-1 ring-inset ring-emerald/30",
    violet: "bg-violet-soft text-violet ring-1 ring-inset ring-violet/30",
  };
  return <span className={`chip ${tones[tone]}`}>{children}</span>;
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`panel ${className}`}>{children}</div>;
}

export function SectionHead({
  eyebrow,
  title,
  desc,
  right,
}: {
  eyebrow?: string;
  title: string;
  desc?: string;
  right?: ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        {eyebrow && (
          <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-accent">{eyebrow}</div>
        )}
        <h2 className="text-[26px] font-bold tracking-tighter2 text-content">{title}</h2>
        {desc && <p className="mt-2 text-[14px] leading-relaxed text-content-muted">{desc}</p>}
      </div>
      {right}
    </div>
  );
}

export function Mono({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <code className={`rounded-md bg-white/[0.06] px-1.5 py-0.5 font-mono text-[12px] text-content ${className}`}>
      {children}
    </code>
  );
}

export function Switch({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      data-on={on}
      onClick={() => !disabled && onChange(!on)}
      className="switch disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span className="switch-knob" />
    </button>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-content-muted">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/20 border-t-accent" />
      {label}
    </span>
  );
}

export function Empty({ icon, label }: { icon?: string; label: string }) {
  return (
    <Panel className="flex h-48 flex-col items-center justify-center gap-2 text-center">
      {icon && <div className="text-3xl opacity-30">{icon}</div>}
      <p className="max-w-xs text-[13px] leading-relaxed text-content-faint">{label}</p>
    </Panel>
  );
}

/** Line-by-line diff view (removed / added highlighting). */
export function DiffView({ before, after }: { before: string; after: string }) {
  const b = before.split("\n");
  const a = after.split("\n");
  const beforeSet = new Set(b);
  const afterSet = new Set(a);
  return (
    <div className="overflow-x-auto font-mono text-[12.5px] leading-[1.7]">
      {a.map((line, i) => {
        const added = !beforeSet.has(line) && line.trim().length > 0;
        return (
          <div key={`a${i}`} className={`flex ${added ? "bg-emerald-soft" : ""}`}>
            <span className="w-9 shrink-0 select-none pr-3 text-right text-content-faint">{i + 1}</span>
            <span className={`w-4 shrink-0 select-none ${added ? "text-emerald" : "text-transparent"}`}>{added ? "+" : " "}</span>
            <span className={added ? "text-emerald" : "text-content-muted"}>{line || " "}</span>
          </div>
        );
      })}
      {b
        .filter((line) => !afterSet.has(line) && line.trim().length > 0)
        .map((line, i) => (
          <div key={`r${i}`} className="flex bg-rose-soft opacity-70">
            <span className="w-9 shrink-0 select-none pr-3 text-right text-content-faint">–</span>
            <span className="w-4 shrink-0 select-none text-rose">-</span>
            <span className="text-rose line-through decoration-rose/40">{line}</span>
          </div>
        ))}
    </div>
  );
}

export function LangBadge({ lang }: { lang: string }) {
  const map: Record<string, string> = {
    TYPESCRIPT: "TS",
    JAVASCRIPT: "JS",
    PYTHON: "PY",
    JAVA: "JAVA",
    C: "C",
    CPP: "C++",
    GO: "GO",
    RUBY: "RB",
  };
  return <span className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] uppercase text-content-faint">{map[lang] ?? lang}</span>;
}

/**
 * Progress bar with an optional label + percentage. Pass `indeterminate` for
 * phases whose length is unknown (a pulsing full-width bar, no percentage).
 */
export function ProgressBar({
  percent = 0,
  label,
  indeterminate = false,
}: {
  percent?: number;
  label?: string;
  indeterminate?: boolean;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div>
      {(label || !indeterminate) && (
        <div className="mb-1.5 flex items-center justify-between text-[11px]">
          <span className="truncate text-content-muted">{label}</span>
          {!indeterminate && <span className="ml-2 shrink-0 font-semibold tabular-nums text-accent">{pct}%</span>}
        </div>
      )}
      <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.06] ring-1 ring-inset ring-line">
        <div
          className={`h-full rounded-full bg-gradient-to-r from-accent to-emerald ${
            indeterminate ? "w-full animate-pulse" : "transition-[width] duration-500 ease-out"
          }`}
          style={indeterminate ? undefined : { width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
