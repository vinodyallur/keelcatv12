// Path data from Simple Icons (CC0); the Meta mark itself is Meta's trademark.
const META_LOGO_PATH =
  "M6.915 4.03c-1.968 0-3.683 1.28-4.871 3.113C.704 9.208 0 11.883 0 14.449c0 .706.07 1.369.21 1.973a6.624 6.624 0 0 0 .265.86 5.297 5.297 0 0 0 .371.761c.696 1.159 1.818 1.927 3.593 1.927 1.497 0 2.633-.671 3.965-2.444.76-1.012 1.144-1.626 2.663-4.32l.756-1.339.186-.325c.061.1.121.196.183.3l2.152 3.595c.724 1.21 1.665 2.556 2.47 3.314 1.046.987 1.992 1.22 3.06 1.22 1.075 0 1.876-.355 2.455-.843a3.743 3.743 0 0 0 .81-.973c.542-.939.861-2.127.861-3.745 0-2.72-.681-5.357-2.084-7.45-1.282-1.912-2.957-2.93-4.716-2.93-1.047 0-2.088.467-3.053 1.308-.652.57-1.257 1.29-1.82 2.05-.69-.875-1.335-1.547-1.958-2.056-1.182-.966-2.315-1.303-3.454-1.303zm10.16 2.053c1.147 0 2.188.758 2.992 1.999 1.132 1.748 1.647 4.195 1.647 6.4 0 1.548-.368 2.9-1.839 2.9-.58 0-1.027-.23-1.664-1.004-.496-.601-1.343-1.878-2.832-4.358l-.617-1.028a44.908 44.908 0 0 0-1.255-1.98c.07-.109.141-.224.211-.327 1.12-1.667 2.118-2.602 3.358-2.602zm-10.201.553c1.265 0 2.058.791 2.675 1.446.307.327.737.871 1.234 1.579l-1.02 1.566c-.757 1.163-1.882 3.017-2.837 4.338-1.191 1.649-1.81 1.817-2.486 1.817-.524 0-1.038-.237-1.383-.794-.263-.426-.464-1.13-.464-2.046 0-2.221.63-4.535 1.66-6.088.454-.687.964-1.226 1.533-1.533a2.264 2.264 0 0 1 1.088-.285z";

function MetaMark({ size }: { size: "lg" | "sm" | "xs" }) {
  const gradientId = `meta-logo-${size}`;
  return (
    <svg
      role="img"
      aria-label="Meta"
      viewBox="0 3.5 24 17"
      className={size === "lg" ? "h-10 w-auto" : size === "sm" ? "h-6 w-auto" : "h-4 w-auto shrink-0"}
      style={{ filter: "drop-shadow(0 0 10px rgba(120, 180, 255, 0.6))" }}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#a9ccff" />
        </linearGradient>
      </defs>
      <path d={META_LOGO_PATH} fill={`url(#${gradientId})`} />
    </svg>
  );
}

const MODELS = ["Muse Spark 1.3", "Llama 4 Maverick", "Llama 4 Scout"];

/** Shown to guests under the Run button while the default Meta model covers them. */
export function MetaGuestNote({ model }: { model?: string }) {
  return (
    <div className="meta-card relative mt-3 overflow-hidden rounded-xl px-3.5 py-2.5">
      <div className="meta-shine" aria-hidden="true" />
      <div className="relative flex items-center gap-2.5 text-[12px] leading-snug text-[#cfe0ff]">
        <MetaMark size="xs" />
        <span>
          <b className="font-bold text-white">Meta {model || "Muse Spark"}</b> is set as the default model for guests
        </span>
      </div>
    </div>
  );
}

/** Hero card for the public home page and the signed-in Overview. */
export function MetaCard({ onAction, actionLabel = "Try it free →" }: { onAction: () => void; actionLabel?: string }) {
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
          {actionLabel}
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
