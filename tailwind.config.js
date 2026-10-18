/** Color token backed by a CSS variable, so Tailwind alpha modifiers keep
 *  working (rgb(var(--x) / <alpha>)) AND themes can switch at runtime. */
const v = (name) => `rgb(var(${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class", '[data-theme="dark"]'],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: v("--canvas"),
        surface: {
          DEFAULT: v("--surface"),
          raised: v("--surface-raised"),
          hover: v("--surface-hover"),
        },
        line: {
          DEFAULT: v("--line"),
          strong: v("--line-strong"),
        },
        content: {
          DEFAULT: v("--content"),
          muted: v("--content-muted"),
          faint: v("--content-faint"),
        },
        accent: {
          DEFAULT: v("--accent"),
          dim: v("--accent-dim"),
          soft: "rgb(var(--accent) / 0.14)",
        },
        violet: { DEFAULT: v("--violet"), soft: "rgb(var(--violet) / 0.16)" },
        sky: { DEFAULT: v("--sky"), soft: "rgb(var(--sky) / 0.16)" },
        rose: { DEFAULT: v("--rose"), soft: "rgb(var(--rose) / 0.16)" },
        amber: { DEFAULT: v("--amber"), soft: "rgb(var(--amber) / 0.16)" },
        emerald: { DEFAULT: v("--emerald"), soft: "rgb(var(--emerald) / 0.16)" },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "monospace"],
      },
      letterSpacing: {
        tightest: "-0.045em",
        tighter2: "-0.03em",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        shimmer: { "100%": { transform: "translateX(100%)" } },
        "pulse-ring": {
          "0%": { transform: "scale(0.85)", opacity: "0.6" },
          "100%": { transform: "scale(2.2)", opacity: "0" },
        },
        float: { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-12px)" } },
        "gradient-pan": {
          "0%,100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.6s cubic-bezier(0.16,1,0.3,1) both",
        "fade-in": "fade-in 0.5s ease both",
        shimmer: "shimmer 2.2s infinite",
        "pulse-ring": "pulse-ring 2.4s cubic-bezier(0.4,0,0.6,1) infinite",
        float: "float 7s ease-in-out infinite",
        "gradient-pan": "gradient-pan 8s ease infinite",
      },
    },
  },
  plugins: [],
};
