import { useState } from "react";

// Shows public/meta-logo.svg when that file exists (add an officially licensed logo there), otherwise a bold wordmark.
function MetaMark({ size }: { size: "lg" | "sm" }) {
  const [hasLogo, setHasLogo] = useState(true);
  if (hasLogo) {
    return <img src="/meta-logo.svg" alt="Meta" className={size === "lg" ? "h-7 w-auto" : "h-5 w-auto"} onError={() => setHasLogo(false)} />;
  }
  return <span className={`font-extrabold tracking-tight text-white ${size === "lg" ? "text-[24px]" : "text-[16px]"}`}>Meta</span>;
}

const MODELS = ["Muse Spark 1.3", "Llama 4 Maverick", "Llama 4 Scout"];

/** Hero card for the public home page. */
export function MetaCard({ onAction }: { onAction: () => void }) {
  return (
    <div className="meta-card relative overflow-hidden rounded-3xl p-7 text-white">
      <div className="meta-shine" aria-hidden="true" />
      <div className="relative">
        <div className="flex items-center gap-3">
          <img src="/keelcat-icon.png" alt="KeelCat" className="h-9 w-auto" />
          <span className="text-[22px] font-light text-white/60" aria-hidden="true">×</span>
          <MetaMark size="lg" />
        </div>
        <div className="mt-6 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#9cc3ff]">Now live</div>
        <div className="mt-2 text-[26px] font-extrabold leading-tight">KeelCat now available with Meta models</div>
        <p className="mt-3 text-[13px] leading-relaxed text-white/75">
          More performance, less cost. Free runs for guest users on Meta models.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {MODELS.map((m) => (
            <span key={m} className="rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white/90">
              {m}
            </span>
          ))}
        </div>
        <button
          onClick={onAction}
          className="mt-6 w-full rounded-xl bg-white px-4 py-2.5 text-[14px] font-bold text-[#0a4fd6] transition hover:bg-[#e8f0ff]"
        >
          Try it free →
        </button>
      </div>
    </div>
  );
}

/** Slim version shown at the top of the signed-in app. */
export function MetaStrip({ onAction }: { onAction?: () => void }) {
  return (
    <div className="meta-card relative mb-6 overflow-hidden rounded-2xl px-5 py-3.5 text-white">
      <div className="meta-shine" aria-hidden="true" />
      <div className="relative flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <img src="/keelcat-icon.png" alt="KeelCat" className="h-6 w-auto" />
            <span className="font-light text-white/60" aria-hidden="true">×</span>
            <MetaMark size="sm" />
          </div>
          <div>
            <div className="text-[14px] font-extrabold leading-snug">KeelCat now available with Meta models</div>
            <div className="text-[11px] text-white/75">More performance, less cost. Free runs for guest users on Meta models.</div>
          </div>
        </div>
        {onAction && (
          <button
            onClick={onAction}
            className="rounded-lg bg-white px-3.5 py-1.5 text-[12px] font-bold text-[#0a4fd6] transition hover:bg-[#e8f0ff]"
          >
            Run a changelog →
          </button>
        )}
      </div>
    </div>
  );
}
