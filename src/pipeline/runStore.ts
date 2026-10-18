// Module-level run store: owns the lifecycle + state of a changelog run so it
// SURVIVES navigation. The Changelog view unmounts when you switch nav tabs, but
// a run (and its progress) lives here, independent of any component. Views
// subscribe via useSyncExternalStore and always render the live state — so
// leaving mid-run and coming back shows the same in-flight progress, not a reset.

import { api, type ChangeSpec, type RunOutput } from "../api";
import { runLocal } from "./runLocal";

export type RunMode = "local" | "server";

export interface RunProgress {
  done: number;
  total: number;
  current: string | null;
}

export interface RunState {
  running: boolean;
  mode: RunMode | null;
  progress: RunProgress | null;
  result: RunOutput | null;
  error: string | null;
  upgrade: boolean; // 402 / out-of-free-runs → the view should prompt upgrade
}

const LS_RESULT = "apisteward.changelog.result";

function loadResult(): RunOutput | null {
  try {
    const v = localStorage.getItem(LS_RESULT);
    return v ? (JSON.parse(v) as RunOutput) : null;
  } catch {
    return null;
  }
}

// The last run's result is persisted so a full page reload still shows it.
let state: RunState = {
  running: false,
  mode: null,
  progress: null,
  result: loadResult(),
  error: null,
  upgrade: false,
};

const listeners = new Set<() => void>();

function set(patch: Partial<RunState>): void {
  state = { ...state, ...patch };
  if ("result" in patch) {
    try {
      if (state.result) localStorage.setItem(LS_RESULT, JSON.stringify(state.result));
      else localStorage.removeItem(LS_RESULT);
    } catch {
      /* ignore storage quota / privacy mode */
    }
  }
  listeners.forEach((l) => l());
}

export const runStore = {
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },
  getSnapshot(): RunState {
    return state;
  },
  clearResult(): void {
    set({ result: null, error: null, upgrade: false });
  },
  dismissUpgrade(): void {
    set({ upgrade: false });
  },
  /**
   * Start a run. Fire-and-forget from the caller's perspective — the run lives
   * here, so it keeps going (and keeps updating progress) even if the view that
   * started it unmounts. A second call while one is running is a no-op.
   */
  async start(mode: RunMode, changes: ChangeSpec[], changelogText?: string): Promise<void> {
    if (state.running) return;
    set({
      running: true,
      mode,
      progress: mode === "local" ? { done: 0, total: 0, current: null } : null,
      result: null,
      error: null,
      upgrade: false,
    });
    try {
      let out: RunOutput;
      if (mode === "local") {
        out = await runLocal(changes, changelogText, {
          onStart: (total) => set({ progress: { done: 0, total, current: null } }),
          onRepoStart: (repo) =>
            set({ progress: { done: state.progress?.done ?? 0, total: state.progress?.total ?? 0, current: repo.fullName } }),
          onRepoDone: () =>
            set({ progress: state.progress ? { ...state.progress, done: state.progress.done + 1, current: null } : null }),
        });
      } else {
        out = await api.run(changes, changelogText);
      }
      set({ result: out, running: false, mode: null, progress: null });
    } catch (e) {
      const msg = (e as Error).message;
      // Same 402 detection as before → the view opens the upgrade modal.
      if (/free runs|upgrade to premium/i.test(msg)) set({ running: false, mode: null, progress: null, upgrade: true });
      else set({ running: false, mode: null, progress: null, error: msg });
    }
  },
};
