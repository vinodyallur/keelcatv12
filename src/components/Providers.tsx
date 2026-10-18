import { useEffect, useState } from "react";
import { api, type RegistryProvider } from "../api";
import { Panel, SectionHead, Chip, Switch, Spinner, Empty } from "./ui";

const BLANK = { name: "", sdkPackage: "", changelogUrl: "", enabled: true, watch: false };

export default function Providers() {
  const [providers, setProviders] = useState<RegistryProvider[]>([]);
  const [form, setForm] = useState({ ...BLANK });
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setProviders(await api.providers.list());
  }
  useEffect(() => {
    refresh().catch(() => {});
  }, []);

  async function save() {
    if (!form.name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const payload: any = {
        name: form.name.trim(),
        sdkPackage: form.sdkPackage.trim() || undefined,
        changelogUrl: form.changelogUrl.trim() || undefined,
        enabled: form.enabled,
        watch: form.watch,
      };
      if (editing) payload.id = editing;
      setProviders(await api.providers.save(payload));
      setForm({ ...BLANK });
      setEditing(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function patch(p: RegistryProvider, patch: Partial<RegistryProvider>) {
    setProviders(await api.providers.save({ ...p, ...patch }));
  }

  async function remove(id: string) {
    setProviders(await api.providers.remove(id));
    if (editing === id) {
      setEditing(null);
      setForm({ ...BLANK });
    }
  }

  function edit(p: RegistryProvider) {
    setEditing(p.id);
    setForm({ name: p.name, sdkPackage: p.sdkPackage ?? "", changelogUrl: p.changelogUrl ?? "", enabled: p.enabled, watch: p.watch });
  }

  return (
    <div className="animate-fade-up space-y-6">
      <SectionHead
        eyebrow="Registry"
        title="Provider registry"
        desc="The API providers KeelCat knows about. Add a changelog URL and turn on watching, and God Mode will pick up new breaking changes automatically."
      />

      {error && <Panel className="border-rose/30 bg-rose-soft p-4 text-[13px] text-rose">{error}</Panel>}

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Add / edit form */}
        <Panel className="p-5 lg:col-span-2">
          <div className="text-[13px] font-semibold text-content">{editing ? "Edit provider" : "Add a provider"}</div>
          <div className="mt-4 space-y-3">
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-content">Name</label>
              <input className="field" placeholder="Stripe" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-content">SDK package <span className="text-content-faint">(optional)</span></label>
              <input className="field font-mono text-[12px]" placeholder="stripe" value={form.sdkPackage} onChange={(e) => setForm({ ...form, sdkPackage: e.target.value })} />
            </div>
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-content">Changelog URL <span className="text-content-faint">(optional)</span></label>
              <input className="field font-mono text-[12px]" placeholder="https://…/CHANGELOG.md" value={form.changelogUrl} onChange={(e) => setForm({ ...form, changelogUrl: e.target.value })} />
              <p className="mt-1 text-[11px] text-content-faint">A raw text/markdown URL. God Mode polls this for new changes.</p>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-line bg-white/[0.02] px-3.5 py-2.5">
              <span className="text-[12px] text-content">Enabled</span>
              <Switch on={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} />
            </div>
            <div className="flex items-center justify-between rounded-xl border border-line bg-white/[0.02] px-3.5 py-2.5">
              <div>
                <div className="text-[12px] text-content">Watch changelog</div>
                <div className="text-[11px] text-content-faint">Auto-detect changes in God Mode</div>
              </div>
              <Switch on={form.watch} onChange={(v) => setForm({ ...form, watch: v })} />
            </div>
            <div className="flex gap-2 pt-1">
              <button className="btn-accent flex-1" onClick={save} disabled={busy || !form.name.trim()}>
                {busy ? <Spinner label="Saving…" /> : editing ? "Update provider" : "Add provider"}
              </button>
              {editing && (
                <button className="btn-ghost" onClick={() => { setEditing(null); setForm({ ...BLANK }); }}>Cancel</button>
              )}
            </div>
          </div>
        </Panel>

        {/* List */}
        <div className="lg:col-span-3">
          {providers.length === 0 ? (
            <Empty icon="✦" label="No providers yet. Add one to start watching for API changes." />
          ) : (
            <div className="space-y-3">
              {providers.map((p) => (
                <Panel key={p.id} className="card-hover p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[14px] font-semibold text-content">{p.name}</span>
                        {p.watch && p.changelogUrl && <Chip tone="accent">watching</Chip>}
                        {!p.enabled && <Chip tone="neutral">paused</Chip>}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-content-faint">
                        {p.sdkPackage && <span className="font-mono">pkg: {p.sdkPackage}</span>}
                        {p.changelogUrl ? (
                          <a href={p.changelogUrl} target="_blank" rel="noreferrer" className="max-w-[280px] truncate font-mono text-content-muted hover:text-accent">{p.changelogUrl}</a>
                        ) : (
                          <span>no changelog URL</span>
                        )}
                        {p.lastCheckedAt && <span>· checked {new Date(p.lastCheckedAt).toLocaleTimeString()}</span>}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button className="btn-ghost px-2 py-1 text-[12px]" onClick={() => edit(p)}>Edit</button>
                      <button className="btn-ghost px-2 py-1 text-[12px] text-rose hover:bg-rose-soft" onClick={() => remove(p.id)}>✕</button>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-line pt-3">
                    <label className="flex items-center gap-2 text-[12px] text-content-muted">
                      <Switch on={p.enabled} onChange={(v) => patch(p, { enabled: v })} /> Enabled
                    </label>
                    <label className="flex items-center gap-2 text-[12px] text-content-muted">
                      <Switch on={p.watch} onChange={(v) => patch(p, { watch: v })} disabled={!p.changelogUrl} /> Watch
                    </label>
                  </div>
                </Panel>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
