import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
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

export interface DropdownOption {
  value: string;
  label: string;
  hint?: string;
  group?: string;
}

const MENU_HEIGHT = 288;

/** A select whose menu always opens below the field; native selects flip upward near the bottom of the screen. */
export function Dropdown({
  label,
  labelClass,
  value,
  options,
  onChange,
  placeholder = "Select…",
  disabled = false,
}: {
  label: string;
  labelClass: string;
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [box, setBox] = useState<{ top: number; left: number; width: number; maxWidth: number } | null>(null);
  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = options[selectedIndex];

  const place = useCallback(() => {
    const r = button.current?.getBoundingClientRect();
    if (r) setBox({ top: r.bottom + 6, left: r.left, width: r.width, maxWidth: Math.max(r.width, Math.min(448, window.innerWidth - r.left - 12)) });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    // Scroll the page instead of flipping the menu up when there is not enough room below.
    const room = window.innerHeight - (button.current?.getBoundingClientRect().bottom ?? 0) - 16;
    if (room < MENU_HEIGHT) window.scrollBy({ top: MENU_HEIGHT - room, behavior: "instant" });
    place();
    const onScroll = (e: Event) => {
      if (!menu.current?.contains(e.target as Node)) place();
    };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!button.current?.contains(target) && !menu.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => {
    const item = open ? document.getElementById(`${id}-${active}`) : null;
    const list = menu.current;
    if (!item || !list) return;
    if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop;
    else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight;
    }
  }, [open, active, id, box]);

  function openMenu() {
    setActive(Math.max(0, selectedIndex));
    setOpen(true);
  }

  function choose(i: number) {
    if (options[i]) onChange(options[i].value);
    setOpen(false);
    button.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "Escape" || e.key === "Tab") {
      setOpen(false);
      return;
    }
    const last = options.length - 1;
    const moves: Record<string, (i: number) => number> = {
      ArrowDown: (i) => Math.min(last, i + 1),
      ArrowUp: (i) => Math.max(0, i - 1),
      Home: () => 0,
      End: () => last,
    };
    if (moves[e.key] || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!open) openMenu();
      else if (moves[e.key]) setActive(moves[e.key]);
      else choose(active);
      return;
    }
    // Type-ahead, like a native select.
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = Date.now();
      const text = (now - typed.current.at < 700 ? typed.current.text : "") + e.key.toLowerCase();
      typed.current = { text, at: now };
      const from = (open ? active : Math.max(0, selectedIndex)) + (text.length === 1 ? 1 : 0);
      const hit = options.map((_, k) => (from + k) % options.length).find((k) => options[k].label.toLowerCase().startsWith(text));
      if (hit === undefined) return;
      if (open) setActive(hit);
      else onChange(options[hit].value);
    }
  }

  return (
    <div>
      <span id={`${id}-label`} className={labelClass}>
        {label}
      </span>
      <button
        ref={button}
        type="button"
        role="combobox"
        aria-labelledby={`${id}-label`}
        aria-controls={`${id}-menu`}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
        className="field field-select flex items-center gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className={`min-w-0 flex-1 truncate ${selected ? "" : "text-content-faint"}`}>{selected?.label ?? placeholder}</span>
        {selected?.hint && <span className="max-w-[45%] shrink-0 truncate text-[11px] text-content-faint">{selected.hint}</span>}
      </button>
      {open &&
        box &&
        createPortal(
          <ul
            ref={menu}
            id={`${id}-menu`}
            role="listbox"
            aria-labelledby={`${id}-label`}
            style={{ top: box.top, left: box.left, minWidth: box.width, maxWidth: box.maxWidth, maxHeight: MENU_HEIGHT }}
            className="fixed z-[100] w-max overflow-y-auto rounded-xl border border-line-strong bg-surface-raised py-1 shadow-2xl"
          >
            {options.map((o, i) => (
              <Fragment key={o.value}>
                {o.group && o.group !== options[i - 1]?.group && (
                  <li role="presentation" className="px-3.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-content-faint">
                    {o.group}
                  </li>
                )}
                <li
                  id={`${id}-${i}`}
                  role="option"
                  aria-selected={o.value === value}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(i)}
                  className={`flex cursor-pointer items-center gap-4 px-3.5 py-2 text-[13px] ${i === active ? "bg-surface-hover" : ""} ${
                    o.value === value ? "font-medium text-accent" : "text-content"
                  }`}
                >
                  <span className="min-w-0 flex-1">{o.label}</span>
                  {o.hint && <span className="shrink-0 text-[11px] text-content-faint">{o.hint}</span>}
                </li>
              </Fragment>
            ))}
          </ul>,
          document.body,
        )}
    </div>
  );
}
