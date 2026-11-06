import { describe, it, expect } from "vitest";
import { toCatalog } from "./catalog.js";

const raw = [
  { id: "meta/muse-spark-1.3", name: "Meta: Muse Spark 1.3", created: 2, pricing: { prompt: "0.00000125", completion: "0.00000425" }, architecture: { output_modalities: ["text"] } },
  { id: "meta/muse-wonder", name: "Meta: Muse Wonder", created: 1, pricing: { prompt: "0.000004", completion: "0.00002" } },
  { id: "mistralai/mistral-large", name: "Mistral Large", pricing: { prompt: "0.000002", completion: "0.000006" } },
  { id: "mistralai/mistral-small", name: "Mistral: Mistral Small", pricing: { prompt: "0.0000001", completion: "0.0000003" } },
  { id: "openrouter/auto", name: "Auto Router", pricing: { prompt: "-1", completion: "-1" } },
  { id: "x/free:free", name: "X: Free", pricing: { prompt: "0", completion: "0" } },
  { id: "img/gen", name: "Img: Gen", pricing: { prompt: "0", completion: "0" }, architecture: { output_modalities: ["image"] } },
  { id: "old/model", name: "Old: Model", expiration_date: "2026-01-01", pricing: { prompt: "0", completion: "0" } },
];

describe("OpenRouter model catalog", () => {
  const models = toCatalog(raw, "2026-11-06");

  it("keeps text models that are not retired, priciest first", () => {
    expect(models.map((m) => m.id)).toEqual([
      "meta/muse-wonder",
      "mistralai/mistral-large",
      "meta/muse-spark-1.3",
      "mistralai/mistral-small",
      "x/free:free",
      "openrouter/auto",
    ]);
  });

  it("splits the vendor from the name and prices per 1M tokens", () => {
    expect(models[0]).toEqual({ id: "meta/muse-wonder", vendor: "Meta", name: "Muse Wonder", input: 4, output: 20 });
  });

  it("names the vendor of unprefixed models from the same slug", () => {
    expect(models.find((m) => m.id === "mistralai/mistral-large")).toMatchObject({ vendor: "Mistral", name: "Mistral Large" });
  });

  it("marks router prices as varying", () => {
    expect(models.find((m) => m.id === "openrouter/auto")).toMatchObject({ input: null, output: null });
  });
});
