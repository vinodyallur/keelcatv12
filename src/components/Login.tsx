import { useState } from "react";
import { api, type AuthState } from "../api";

/**
 * Sign-in modal, shown as an overlay on top of the public landing page. Having
 * real marketing content behind it (instead of a bare login screen) is both
 * better UX and keeps automated phishing scanners from flagging the site.
 * `onClose` lets visitors dismiss it to read the landing page first.
 */
export default function Login({ auth, onClose }: { auth: AuthState | null; onClose?: () => void }) {
  const showGithub = auth?.github ?? true;
  const showGoogle = auth?.google ?? false;
  const showGuest = auth?.guest ?? false;
  const [guestName, setGuestName] = useState("");
  const [busy, setBusy] = useState(false);

  async function continueAsGuest() {
    if (busy) return;
    setBusy(true);
    try {
      await api.auth.guest(guestName.trim() || "Guest");
      window.location.reload();
    } catch {
      setBusy(false);
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="panel relative w-full max-w-md p-8 text-center">
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface text-content-muted transition-all hover:text-content hover:border-line-strong"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-4 w-4">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        )}
        <div className="mx-auto mb-6 flex items-center justify-center gap-2">
          <img src="/keelcat-icon.png" alt="" className="h-10 w-auto object-contain" />
          <img src="/keelcat-wordmark.png" alt="KeelCat" className="h-5 w-auto max-w-[160px] object-contain" />
        </div>
        <h1 className="text-[22px] font-bold tracking-tighter2 text-content">Sign in to KeelCat</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-content-muted">
          Your repos, connections, and runs live in your own private workspace. Sign in to get started.
        </p>

        <div className="mt-7 space-y-3">
          {showGithub && (
            <a
              href={api.auth.loginUrl("github")}
              className="inline-flex w-full items-center justify-center gap-2.5 rounded-xl bg-content px-4 py-3 text-[15px] font-semibold text-canvas transition hover:opacity-90"
            >
              <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
              Sign in with GitHub
            </a>
          )}
          {showGoogle && (
            <a
              href={api.auth.loginUrl("google")}
              className="inline-flex w-full items-center justify-center gap-2.5 rounded-xl border border-line bg-surface px-4 py-3 text-[15px] font-semibold text-content transition hover:border-line-strong"
            >
              <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
                <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 01-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
                <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 009 18z" />
                <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 010-3.44V4.95H.96a9 9 0 000 8.1l3.01-2.33z" />
                <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.42 0 9 0A9 9 0 00.96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
              </svg>
              Sign in with Google
            </a>
          )}
        </div>

        {showGuest && (
          <div className="mt-6">
            <div className="mb-3 flex items-center gap-3 text-[11px] uppercase tracking-[0.2em] text-content-faint">
              <span className="h-px flex-1 bg-line" />
              or just try it
              <span className="h-px flex-1 bg-line" />
            </div>
            <div className="flex gap-2">
              <input
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && continueAsGuest()}
                placeholder="Your name"
                maxLength={40}
                className="field flex-1"
              />
              <button onClick={continueAsGuest} disabled={busy} className="btn-outline whitespace-nowrap disabled:opacity-50">
                {busy ? "…" : "Continue as guest"}
              </button>
            </div>
            <p className="mt-2 text-[11px] text-content-faint">
              Guest workspaces are temporary and saved only in this browser — great for a quick look around.
            </p>
          </div>
        )}

        <p className="mt-4 text-[12px] text-content-muted">
          We only read your basic profile to identify your workspace. Connecting repos is a separate step you control.
        </p>
      </div>
    </div>
  );
}
