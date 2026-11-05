import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const state = vi.hoisted(() => ({
  llm: { provider: "custom", model: "user-model", baseUrl: "https://user.example/v1" } as { provider: string; model: string; baseUrl?: string },
  ownKey: undefined as string | undefined,
  shared: null as { baseUrl: string; model: string; key: string } | null,
  recordUse: vi.fn(),
}));

vi.mock("../config/store.js", () => ({
  getConfig: () => ({ llm: state.llm }),
  getLlmKey: () => state.ownKey,
}));

vi.mock("../config/default-llm.js", () => ({
  defaultLlmFor: () => state.shared,
  recordDefaultLlmUse: state.recordUse,
}));

import { chat, llmConfigured } from "./client.js";

const okResponse = () => new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => okResponse());
const ask = () => chat({ messages: [{ role: "user", content: "hi" }] });

function lastRequest() {
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  return {
    url,
    auth: (init.headers as Record<string, string>).authorization,
    model: JSON.parse(init.body as string).model as string,
  };
}

beforeEach(() => {
  state.llm = { provider: "custom", model: "user-model", baseUrl: "https://user.example/v1" };
  state.ownKey = undefined;
  state.shared = { baseUrl: "https://shared.example/v1", model: "auto", key: "shared-key" };
  state.recordUse.mockClear();
  fetchMock.mockClear();
  fetchMock.mockImplementation(async () => okResponse());
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LLM resolution with an admin default", () => {
  it("sends the shared key only to the admin's URL and model, never the workspace's", async () => {
    await ask();
    expect(lastRequest()).toEqual({ url: "https://shared.example/v1/chat/completions", auth: "Bearer shared-key", model: "auto" });
    expect(state.recordUse).toHaveBeenCalledTimes(1);
  });

  it("prefers the workspace's own key and endpoint", async () => {
    state.ownKey = "own-key";
    await ask();
    expect(lastRequest()).toEqual({ url: "https://user.example/v1/chat/completions", auth: "Bearer own-key", model: "user-model" });
    expect(state.recordUse).not.toHaveBeenCalled();
  });

  it("respects a workspace that turned AI off", async () => {
    state.llm = { provider: "disabled", model: "user-model" };
    expect(llmConfigured()).toBe(false);
    await expect(ask()).rejects.toThrow("No LLM configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is unconfigured when there is no own key and no default for this workspace", () => {
    state.shared = null;
    expect(llmConfigured()).toBe(false);
  });

  it("hides upstream error details from users of the shared default", async () => {
    fetchMock.mockImplementation(async () => new Response("upstream detail https://shared.example/v1 model auto", { status: 500 }));
    await expect(ask()).rejects.toThrow("KeelCat AI request failed (500).");
  });
});
