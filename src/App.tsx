import { useEffect, useState } from "react";
import { api, type PublicConfig, type AuthState, type AuthUser } from "./api";
import { Panel, Chip } from "./components/ui";
import Login from "./components/Login";
import Landing from "./components/Landing";
import Connect from "./components/Connect";
import Changelog from "./components/Changelog";
import Repositories from "./components/Repositories";
import Providers from "./components/Providers";
import Security from "./components/Security";
import Runs from "./components/Runs";
import SettingsPage from "./components/SettingsPage";
import Admin from "./components/Admin";
import Pricing from "./components/Pricing";

type View = "overview" | "changelog" | "repos" | "providers" | "security" | "connect" | "runs" | "settings" | "pricing" | "admin";
export type Skin = "modern" | "skeuo";

const NAV: { key: View; label: string; glyph: string; group: string }[] = [
  { key: "overview", label: "Overview", glyph: "◱", group: "Workspace" },
  { key: "changelog", label: "Changelog → PRs", glyph: "✦", group: "Workspace" },
  { key: "repos", label: "Repositories", glyph: "⊚", group: "Workspace" },
  { key: "providers", label: "Providers", glyph: "❖", group: "Workspace" },
  { key: "security", label: "Security", glyph: "🛡", group: "Workspace" },
  { key: "connect", label: "Connect", glyph: "⎇", group: "Setup" },
  { key: "runs", label: "Runs & activity", glyph: "≡", group: "Setup" },
  { key: "settings", label: "Settings", glyph: "⚙", group: "Setup" },
  { key: "pricing", label: "Pricing", glyph: "◇", group: "Setup" },
  { key: "admin", label: "Admin", glyph: "★", group: "Admin" },
];

export default function App() {
  const [view, setView] = useState<View>("overview");
  const [online, setOnline] = useState<boolean | null>(null);
  const [cfg, setCfg] = useState<PublicConfig | null>(null);
  const [authState, setAuthState] = useState<AuthState | null>(null);
  const [showLogin, setShowLogin] = useState(true);
  const [mobileNav, setMobileNav] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">(
    () => (localStorage.getItem("apisteward.theme") as "dark" | "light") || "dark"
  );
  const [skin, setSkin] = useState<Skin>(
    () => (localStorage.getItem("apisteward.skin") as Skin) || "skeuo"
  );

  useEffect(() => {
    const el = document.documentElement;
    el.dataset.theme = theme;
    el.classList.toggle("dark", theme === "dark");
    // keep the raw <html> backdrop in sync so toggling never leaves a mismatched base
    el.style.background =
      skin === "skeuo"
        ? theme === "light"
          ? "#d8d5cd"
          : "#181a1e"
        : theme === "light"
        ? "#f6f7f9"
        : "#06070a";
    localStorage.setItem("apisteward.theme", theme);
  }, [theme, skin]);

  useEffect(() => {
    document.documentElement.dataset.skin = skin;
    localStorage.setItem("apisteward.skin", skin);
  }, [skin]);

  // Lock background scroll while the mobile nav drawer is open.
  useEffect(() => {
    document.body.style.overflow = mobileNav ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileNav]);

  // Navigate + always close the mobile drawer on selection.
  function navigate(v: View) {
    setView(v);
    setMobileNav(false);
  }

  function loadCfg() {
    api.config.get().then(setCfg).catch(() => {});
  }
  useEffect(() => {
    api.health().then(setOnline);
    // Resolve auth first; only load the (protected) config once we know a
    // session exists, so an unauthenticated visitor doesn't fire a doomed call.
    api.auth
      .config()
      .then((a) => {
        setAuthState(a);
        if (!a.enabled || a.user) loadCfg();
      })
      .catch(() => {
        // If the auth probe fails, assume open mode and try loading anyway.
        setAuthState({ enabled: false, github: false, google: false, guest: false, user: null });
        loadCfg();
      });
  }, []);

  async function signOut() {
    try {
      await api.auth.logout();
    } finally {
      window.location.reload();
    }
  }

  async function toggleGodMode() {
    if (!cfg) return;
    const next = !cfg.settings.godMode;
    setCfg({ ...cfg, settings: { ...cfg.settings, godMode: next } });
    try {
      const updated = await api.auto.setGodMode(next);
      setCfg(updated);
    } catch {
      loadCfg();
    }
  }

  // Auth gate: when login is enabled and there's no session, show the public
  // landing page with the sign-in modal on top (dismissable so visitors can
  // read the page first). In open/password mode this is skipped entirely.
  if (authState?.enabled && !authState.user) {
    return (
      <>
        <Landing onSignIn={() => setShowLogin(true)} />
        {showLogin && <Login auth={authState} onClose={() => setShowLogin(false)} />}
      </>
    );
  }

  const isAdmin = authState?.user?.admin ?? false;

  return (
    <div className="flex min-h-screen">
      <Sidebar view={view} setView={navigate} online={online} cfg={cfg} admin={isAdmin} />
      <MobileNav open={mobileNav} onClose={() => setMobileNav(false)} view={view} setView={navigate} online={online} cfg={cfg} admin={isAdmin} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          cfg={cfg}
          user={authState?.user ?? null}
          onSignOut={signOut}
          onToggleGodMode={toggleGodMode}
          theme={theme}
          onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          onMenu={() => setMobileNav(true)}
        />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-10">
          {view === "overview" && <Overview cfg={cfg} go={navigate} />}
          {view === "changelog" && <Changelog onNavigate={(v) => navigate(v as View)} />}
          {view === "repos" && <Repositories />}
          {view === "providers" && <Providers />}
          {view === "security" && <Security />}
          {view === "connect" && <Connect onConfig={setCfg} />}
          {view === "runs" && <Runs />}
          {view === "settings" && <SettingsPage onConfig={setCfg} skin={skin} onSkin={setSkin} />}
          {view === "pricing" && <Pricing cfg={cfg} onUpgraded={() => api.config.get().then(setCfg).catch(() => {})} />}
          {view === "admin" && isAdmin && <Admin />}
        </main>
      </div>
    </div>
  );
}

const ICON_PATHS: Record<View, string> = {
  overview: "M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z",
  changelog: "M6 3v12M6 21a3 3 0 100-6 3 3 0 000 6zM18 6a3 3 0 100-6 3 3 0 000 6zM18 6a9 9 0 01-9 9",
  repos: "M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z",
  providers: "M12 2L3 7v10l9 5 9-5V7zM3 7l9 5 9-5M12 12v10",
  security: "M12 3l7 3v6c0 4-3 7-7 8-4-1-7-4-7-8V6z",
  connect: "M10 13a4 4 0 005.66 0l3-3a4 4 0 10-5.66-5.66l-1.5 1.5M14 11a4 4 0 00-5.66 0l-3 3a4 4 0 105.66 5.66l1.5-1.5",
  runs: "M3 12h4l3 8 4-16 3 8h4",
  settings: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
  pricing: "M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6",
  admin: "M12 2l3 6.5 7 .6-5.3 4.6 1.7 6.8L12 17l-6.1 3.5 1.7-6.8L2.3 9.1l7-.6z",
};

function NavIcon({ name }: { name: View }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

function ThemeToggle({ theme, onToggle }: { theme: "dark" | "light"; onToggle: () => void }) {
  const dark = theme === "dark";
  return (
    <button
      onClick={onToggle}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label="Toggle color theme"
      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface text-content-muted transition-all hover:text-content hover:border-line-strong"
    >
      {dark ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
          <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      )}
    </button>
  );
}

function Logo() {
  return (
    <div className="flex items-center gap-2">
      <img src="/keelcat-icon.png" alt="KeelCat" className="h-9 w-auto object-contain" />
      <img src="/keelcat-wordmark.png" alt="KEELCAT" className="h-4 w-auto max-w-[150px] object-contain" />
    </div>
  );
}

function NavList({ view, setView, admin }: { view: View; setView: (v: View) => void; admin?: boolean }) {
  const groups = admin ? ["Workspace", "Setup", "Admin"] : ["Workspace", "Setup"];
  return (
    <nav className="mt-8">
      {groups.map((group) => (
        <div key={group} className="pb-1">
          <div className="px-3 pb-1.5 pt-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-content-faint">{group}</div>
          {NAV.filter((n) => n.group === group).map((n) => (
            <div key={n.key} className={`nav-item group ${view === n.key ? "nav-item-active" : ""}`} onClick={() => setView(n.key)}>
              <span className={`flex w-5 items-center justify-center ${view === n.key ? "text-accent" : "text-content-faint group-hover:text-content-muted"}`}>
                <NavIcon name={n.key} />
              </span>
              {n.label}
            </div>
          ))}
        </div>
      ))}
    </nav>
  );
}

function StatusCard({ online, cfg }: { online: boolean | null; cfg: PublicConfig | null }) {
  const selected = cfg?.repos.filter((r) => r.selected).length ?? 0;
  return (
    <div className="rounded-xl border border-line bg-white/[0.02] p-3.5">
      <div className="flex items-center gap-2 text-[12px] font-medium text-content">
        <span className={`h-1.5 w-1.5 rounded-full ${online ? "bg-emerald animate-pulse" : online === false ? "bg-rose" : "bg-amber"}`} />
        Status
        <span className="text-content-faint">·</span>
        <span className="text-content-muted">{online ? "Online" : online === false ? "Offline" : "…"}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Chip tone={cfg?.hasPat || cfg?.hasAppKey ? "emerald" : "amber"}>GitHub</Chip>
        <Chip tone={cfg?.hasLlmKey ? "emerald" : "amber"}>LLM</Chip>
        <Chip tone={selected ? "accent" : "amber"}>{selected} Repos</Chip>
      </div>
    </div>
  );
}

function Sidebar({ view, setView, online, cfg, admin }: { view: View; setView: (v: View) => void; online: boolean | null; cfg: PublicConfig | null; admin?: boolean }) {
  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-surface px-4 py-5 lg:flex">
      <div className="px-2"><Logo /></div>
      <NavList view={view} setView={setView} admin={admin} />
      <div className="mt-auto space-y-3">
        <StatusCard online={online} cfg={cfg} />
      </div>
    </aside>
  );
}

function MobileNav({
  open,
  onClose,
  view,
  setView,
  online,
  cfg,
  admin,
}: {
  open: boolean;
  onClose: () => void;
  view: View;
  setView: (v: View) => void;
  online: boolean | null;
  cfg: PublicConfig | null;
  admin?: boolean;
}) {
  return (
    <div className={`fixed inset-0 z-50 lg:hidden ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
      {/* backdrop */}
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${open ? "opacity-100" : "opacity-0"}`}
      />
      {/* drawer */}
      <aside
        className={`absolute left-0 top-0 flex h-full w-[82%] max-w-[300px] flex-col border-r border-line bg-surface px-4 py-5 shadow-2xl transition-transform duration-300 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
      >
        <div className="flex items-center justify-between px-2">
          <Logo />
          <button
            onClick={onClose}
            aria-label="Close navigation"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface text-content-muted transition-all hover:text-content hover:border-line-strong"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-4 w-4">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <NavList view={view} setView={setView} admin={admin} />
        </div>
        <div className="mt-3">
          <StatusCard online={online} cfg={cfg} />
        </div>
      </aside>
    </div>
  );
}

function Topbar({
  cfg,
  user,
  onSignOut,
  onToggleGodMode,
  theme,
  onToggleTheme,
  onMenu,
}: {
  cfg: PublicConfig | null;
  user: AuthUser | null;
  onSignOut: () => void;
  onToggleGodMode: () => void;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  onMenu: () => void;
}) {
  const god = cfg?.settings.godMode ?? false;
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-canvas/70 px-4 py-3 backdrop-blur-xl sm:px-6 sm:py-3.5 lg:px-10">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <button
            onClick={onMenu}
            aria-label="Open navigation"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-content-muted transition-all hover:text-content hover:border-line-strong lg:hidden"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-5 w-5">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
          <img src="/keelcat-icon.png" alt="KeelCat" className="h-8 w-auto object-contain lg:hidden" />
          <div className="hidden items-center gap-2 text-[13px] text-content-muted lg:flex">
            <span className="text-content-faint">Dependabot for APIs</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-2.5">
          <GodModeButton on={god} onClick={onToggleGodMode} disabled={!cfg} />
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          {user && <UserMenu user={user} onSignOut={onSignOut} />}
        </div>
      </div>
    </header>
  );
}

function UserMenu({ user, onSignOut }: { user: AuthUser; onSignOut: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex items-center gap-2 rounded-full border border-line bg-surface py-1 pl-1 pr-2.5">
        {user.avatar ? (
          <img src={user.avatar} alt="" className="h-6 w-6 rounded-full object-cover" />
        ) : (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/20 text-[11px] font-semibold text-accent">
            {(user.login || "?").slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="hidden max-w-[120px] truncate text-[12px] font-medium text-content sm:inline">{user.login}</span>
      </span>
      <button
        onClick={onSignOut}
        title="Sign out"
        className="inline-flex h-8 items-center rounded-full border border-line bg-surface px-3 text-[12px] font-medium text-content-muted transition-all hover:text-content hover:border-line-strong"
      >
        Sign out
      </button>
    </div>
  );
}

function GodModeButton({ on, onClick, disabled }: { on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={on ? "God Mode is on — running fully automatically" : "Turn on God Mode for full automation"}
      className={`group relative inline-flex items-center gap-2 overflow-hidden rounded-full border px-3.5 py-1.5 text-[12px] font-semibold transition-all duration-300 disabled:opacity-40 ${
        on
          ? "border-accent bg-gradient-to-r from-accent to-emerald text-canvas shadow-[0_0_18px_-2px_rgba(168,255,83,0.75)] hover:shadow-[0_0_24px_0px_rgba(168,255,83,0.9)]"
          : "border-line-strong bg-white/[0.03] text-content-muted hover:border-accent/60 hover:bg-accent/[0.06] hover:text-content"
      }`}
    >
      {/* Soft pulsing ring while active */}
      {on && <span className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-accent/40 animate-pulse" />}
      {/* Sheen sweep on hover */}
      <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
      <span className={`relative transition-transform duration-300 ${on ? "text-canvas animate-pulse" : "text-accent group-hover:scale-125"}`}>⚡</span>
      <span className="relative hidden sm:inline">God Mode</span>
      <span className={`relative ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold tracking-wide ${on ? "bg-black/25 text-canvas" : "bg-white/[0.06] text-content-faint"}`}>
        {on ? "ON" : "OFF"}
      </span>
    </button>
  );
}

function Overview({ cfg, go }: { cfg: PublicConfig | null; go: (v: View) => void }) {
  const selected = cfg?.repos.filter((r) => r.selected).length ?? 0;
  const steps: { done: boolean; label: string; view: View }[] = [
    { done: Boolean(cfg?.hasPat || cfg?.hasAppKey), label: "Connect GitHub", view: "connect" },
    { done: Boolean(cfg?.hasLlmKey), label: "Add LLM key", view: "connect" },
    { done: selected > 0, label: "Select repositories", view: "connect" },
    { done: false, label: "Post a changelog", view: "changelog" },
  ];
  return (
    <div className="animate-fade-up space-y-10">
      <div className="relative overflow-hidden rounded-2xl border border-line bg-surface p-6 sm:rounded-3xl sm:p-10">
        <div className="pointer-events-none absolute -right-20 -top-24 h-80 w-80 rounded-full bg-accent/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-violet/10 blur-3xl" />
        <div className="relative max-w-2xl">
          <Chip tone="accent">production</Chip>
          <h1 className="mt-5 text-[32px] font-bold leading-[1.05] tracking-tightest sm:text-[46px] sm:leading-[1.02]">
            <span className="gradient-text">Your APIs change.</span>
            <br />
            <span className="text-content">Your code keeps up.</span>
          </h1>
          <p className="mt-5 max-w-lg text-[14px] leading-relaxed text-content-muted sm:text-[15px]">
            Post an API changelog. KeelCat reads it, finds every affected repo across all your
            languages, rewrites the code, and opens a real pull request on each — for you to review.
            It never merges.
          </p>
          <div className="mt-7 flex flex-col gap-2.5 sm:flex-row">
            <button className="btn-accent" onClick={() => go("changelog")}>Post a changelog →</button>
            <button className="btn-outline" onClick={() => go("connect")}>Connect GitHub</button>
          </div>
        </div>
      </div>

      <div>
        <div className="mb-4 text-[13px] font-semibold text-content">Get started</div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {steps.map((s, i) => (
            <Panel key={s.label} className="card-hover cursor-pointer p-5" >
              <button className="w-full text-left" onClick={() => go(s.view)}>
                <div className="flex items-center justify-between">
                  <div className={`flex h-7 w-7 items-center justify-center rounded-lg text-[13px] font-bold ${s.done ? "bg-accent text-canvas" : "bg-white/[0.06] text-content-faint"}`}>
                    {s.done ? "✓" : i + 1}
                  </div>
                  {s.done && <Chip tone="emerald">done</Chip>}
                </div>
                <div className="mt-3 text-[14px] font-medium text-content">{s.label}</div>
              </button>
            </Panel>
          ))}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel className="p-6">
          <div className="text-[13px] font-semibold text-content">How it works</div>
          <div className="mt-3 space-y-3">
            {[
              ["Read", "An LLM turns your changelog into a precise, structured change list."],
              ["Locate", "We scan each repo across TS, JS, Python, Java, C, C++ for real usages."],
              ["Fix", "Deterministic edits for renames; LLM-assisted for the rest. Ambiguous cases are flagged."],
              ["Verify", "Every edit is syntax-checked and completeness-checked — no broken or half-done PRs."],
              ["Review", "One pull request per affected repo. You approve. We never auto-merge."],
            ].map(([t, d], i) => (
              <div key={t} className="flex gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-soft text-[12px] font-semibold text-accent">{i + 1}</div>
                <div>
                  <div className="text-[13px] font-semibold text-content">{t}</div>
                  <div className="text-[13px] text-content-muted">{d}</div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
        <Panel className="p-6">
          <div className="text-[13px] font-semibold text-content">Languages supported</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {["TypeScript", "JavaScript", "Python", "Java", "C", "C++"].map((l) => (
              <span key={l} className="rounded-lg border border-line bg-white/[0.03] px-3 py-1.5 text-[13px] text-content-muted">{l}</span>
            ))}
          </div>
          <div className="mt-5 text-[13px] font-semibold text-content">Safety</div>
          <ul className="mt-2 space-y-1.5 text-[13px] text-content-muted">
            <li>• Never merges — every change is a reviewable PR.</li>
            <li>• Broken or incomplete edits are flagged, never shipped.</li>
            <li>• Tokens & keys stored locally, never committed.</li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}
