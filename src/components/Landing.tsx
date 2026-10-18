import { Panel, Chip } from "./ui";

/**
 * Public marketing page shown to logged-out visitors, with the sign-in modal
 * layered on top. Real product content here (what it does, how it works, safety,
 * a footer with privacy/terms) makes the site read as a legitimate product to
 * both people and automated safe-browsing scanners.
 */
export default function Landing({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/70 px-4 py-3 backdrop-blur-xl sm:px-6 lg:px-10">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/keelcat-icon.png" alt="KeelCat" className="h-9 w-auto object-contain" />
            <img src="/keelcat-wordmark.png" alt="KEELCAT" className="h-4 w-auto max-w-[150px] object-contain" />
          </div>
          <div className="flex items-center gap-4">
            <a href="#pricing" className="hidden text-[13px] font-medium text-content-muted hover:text-content sm:inline">Pricing</a>
            <button onClick={onSignIn} className="btn-accent">Sign in</button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14 lg:px-10">
        {/* Hero */}
        <section className="relative overflow-hidden rounded-2xl border border-line bg-surface p-6 sm:rounded-3xl sm:p-12">
          <div className="pointer-events-none absolute -right-20 -top-24 h-80 w-80 rounded-full bg-accent/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-violet/10 blur-3xl" />
          <div className="relative max-w-2xl">
            <Chip tone="accent">Dependabot for APIs</Chip>
            <h1 className="mt-5 text-[34px] font-bold leading-[1.05] tracking-tightest sm:text-[52px] sm:leading-[1.02]">
              <span className="gradient-text">Your APIs change.</span>
              <br />
              <span className="text-content">Your code keeps up.</span>
            </h1>
            <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-content-muted sm:text-[16px]">
              The APIs your app depends on change all the time — and quietly break things. KeelCat watches
              for those changes, finds the affected code across your repos, fixes it, and opens a pull
              request for you to review. It never merges on its own.
            </p>
            <div className="mt-7 flex flex-col gap-2.5 sm:flex-row">
              <button className="btn-accent" onClick={onSignIn}>Get started free →</button>
              <a className="btn-outline" href="#how">See how it works</a>
            </div>
            <p className="mt-4 text-[12px] text-content-faint">Sign in with GitHub or Google. Free to try.</p>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="mt-14">
          <h2 className="text-[24px] font-bold tracking-tighter2 text-content sm:text-[28px]">How it works</h2>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {[
              ["Read", "An AI turns an API's changelog into a precise, structured list of changes."],
              ["Locate", "We scan each repo you connect for real usages — across TS, JS, Python, Java, C, C++."],
              ["Fix", "Deterministic edits for renames; AI-assisted for the rest. Ambiguous cases are flagged."],
              ["Verify", "Every edit is syntax- and completeness-checked — no broken or half-done changes."],
              ["Review", "One pull request per affected repo. You approve. We never auto-merge."],
            ].map(([t, d], i) => (
              <Panel key={t} className="p-5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-[14px] font-bold text-accent">{i + 1}</div>
                <div className="mt-3 text-[15px] font-semibold text-content">{t}</div>
                <div className="mt-1 text-[13px] leading-relaxed text-content-muted">{d}</div>
              </Panel>
            ))}
          </div>
        </section>

        {/* Value + safety */}
        <section className="mt-8 grid gap-5 lg:grid-cols-2">
          <Panel className="p-6">
            <div className="text-[15px] font-semibold text-content">Why teams use KeelCat</div>
            <ul className="mt-3 space-y-2 text-[14px] text-content-muted">
              <li>• Stop losing hours to surprise breaking changes from third-party APIs.</li>
              <li>• Catch problems before your users do — not after something goes down.</li>
              <li>• Works across all your repos and languages from one place.</li>
              <li>• Every fix is a reviewable pull request. You stay in control.</li>
            </ul>
          </Panel>
          <Panel className="p-6">
            <div className="text-[15px] font-semibold text-content">Built to be safe</div>
            <ul className="mt-3 space-y-2 text-[14px] text-content-muted">
              <li>• Never merges — every change is a pull request you approve.</li>
              <li>• Broken or incomplete edits are flagged, never shipped.</li>
              <li>• Your tokens and keys are stored securely and never committed.</li>
              <li>• Each account gets its own private, isolated workspace.</li>
            </ul>
          </Panel>
        </section>

        {/* Pricing */}
        <section id="pricing" className="mt-16 scroll-mt-24">
          <div className="text-center">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-accent">Pricing</div>
            <h2 className="mt-2 text-[26px] font-bold tracking-tighter2 text-content sm:text-[32px]">Simple, per-developer pricing</h2>
            <p className="mx-auto mt-2 max-w-md text-[14px] text-content-muted">Start free. Upgrade when KeelCat is saving your team time.</p>
          </div>
          <div className="mt-8 grid gap-4 lg:grid-cols-3">
            {/* Monthly */}
            <Panel className="flex flex-col p-6">
              <div className="text-[15px] font-semibold text-content">Monthly</div>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-[38px] font-bold text-content">$15</span>
                <span className="text-[13px] text-content-muted">/ dev / mo</span>
              </div>
              <p className="mt-1 text-[12px] text-content-faint">Billed monthly. Cancel anytime.</p>
              <ul className="mt-5 flex-1 space-y-2 text-[13px] text-content-muted">
                <li>✓ Unlimited runs &amp; pull requests</li>
                <li>✓ All repos and accounts</li>
                <li>✓ Scheduled watching &amp; God Mode</li>
                <li>✓ Security scanning</li>
              </ul>
              <button onClick={onSignIn} className="btn-outline mt-6 w-full">Get started</button>
            </Panel>

            {/* Annual — highlighted */}
            <Panel className="relative flex flex-col p-6 ring-1 ring-inset ring-accent/40">
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-accent px-3 py-1 text-[11px] font-bold text-canvas">SAVE 20%</span>
              <div className="text-[15px] font-semibold text-content">Annual</div>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-[38px] font-bold text-content">$12</span>
                <span className="text-[13px] text-content-muted">/ dev / mo</span>
              </div>
              <p className="mt-1 text-[12px] text-content-faint">Billed yearly ($144/dev). Best value.</p>
              <ul className="mt-5 flex-1 space-y-2 text-[13px] text-content-muted">
                <li>✓ Everything in Monthly</li>
                <li>✓ 20% off vs monthly</li>
                <li>✓ Priority support</li>
                <li>✓ Early access to new features</li>
              </ul>
              <button onClick={onSignIn} className="btn-accent mt-6 w-full">Get started</button>
            </Panel>

            {/* Enterprise */}
            <Panel className="flex flex-col p-6">
              <div className="text-[15px] font-semibold text-content">Enterprise</div>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-[38px] font-bold text-content">Custom</span>
              </div>
              <p className="mt-1 text-[12px] text-content-faint">For teams with many repos or internal APIs.</p>
              <ul className="mt-5 flex-1 space-y-2 text-[13px] text-content-muted">
                <li>✓ Internal / private APIs</li>
                <li>✓ SSO &amp; access policies</li>
                <li>✓ Dedicated support &amp; SLA</li>
                <li>✓ Volume pricing</li>
              </ul>
              <a href="mailto:hello@keelcat.in?subject=KeelCat%20Enterprise" className="btn-outline mt-6 w-full text-center">Contact us</a>
            </Panel>
          </div>
        </section>

        {/* Final CTA */}
        <section className="mt-16 rounded-2xl border border-line bg-surface p-8 text-center sm:p-12">
          <h2 className="text-[24px] font-bold tracking-tighter2 text-content sm:text-[30px]">Keep your integrations from breaking</h2>
          <p className="mx-auto mt-3 max-w-md text-[14px] leading-relaxed text-content-muted">
            Connect a repo and let KeelCat watch the APIs you depend on. Setup takes a minute.
          </p>
          <button className="btn-accent mt-6" onClick={onSignIn}>Get started free →</button>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-line px-4 py-8 sm:px-6 lg:px-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 text-[12px] text-content-faint sm:flex-row">
          <span>© {new Date().getFullYear()} KeelCat. Automated API maintenance.</span>
          <div className="flex items-center gap-4">
            <a href="#privacy" className="hover:text-content-muted">Privacy</a>
            <a href="#terms" className="hover:text-content-muted">Terms</a>
            <a href="mailto:hello@keelcat.in" className="hover:text-content-muted">Contact</a>
          </div>
        </div>
        <div className="mx-auto mt-6 max-w-6xl space-y-4 text-[11px] leading-relaxed text-content-faint">
          <p id="privacy">
            <span className="font-semibold text-content-muted">Privacy:</span> KeelCat reads only the public
            profile from your GitHub or Google sign-in to identify your workspace. Repository access is granted
            separately and only for repos you choose. We do not sell personal data. Contact hello@keelcat.in to
            request deletion of your data.
          </p>
          <p id="terms">
            <span className="font-semibold text-content-muted">Terms:</span> KeelCat is provided as-is. It opens
            pull requests for your review and never merges code on its own; you are responsible for reviewing and
            approving any changes before they are merged.
          </p>
        </div>
      </footer>
    </div>
  );
}
