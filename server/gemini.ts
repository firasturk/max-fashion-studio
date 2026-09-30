/**
 * Optional automated review with Gemini 2.5 Flash through the Interactions API,
 * kept from the original brief. Runs only when GEMINI_API_KEY is configured.
 */
import type { QA } from "@shared/types";
import { StudioError } from "./errors";

interface ImageInput {
  type: "image";
  mime_type: string;
  data: string;
}

interface InteractionResponse {
  status?: string;
  steps?: { type: string; content?: { type: string; text?: string }[] }[];
}

const SCHEMA = {
  type: "object",
  properties: {
    found: { type: "boolean" },
    count: { type: "integer" },
    box: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
    productConcern: { type: "boolean" },
    notes: { type: "string" },
  },
  required: ["found", "count", "box", "productConcern", "notes"],
};

function toBase64(bytes: ArrayBuffer): string {
  let s = "";
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i += 0x8000)
    s += String.fromCharCode(...view.subarray(i, i + 0x8000));
  return btoa(s);
}

export function manualQA(
  notes = "Automatic review not configured. Compare with the original manually.",
): QA {
  return { found: false, count: 0, box: [], productConcern: false, notes, automated: false };
}

export async function inspectWithGemini(
  key: string,
  source: { bytes: ArrayBuffer; mime: string },
  result: { bytes: ArrayBuffer; mime: string },
  fabric: boolean,
  fetchImpl: typeof fetch = fetch,
): Promise<QA> {
  const images: ImageInput[] = [
    { type: "image", mime_type: source.mime, data: toBase64(source.bytes) },
    { type: "image", mime_type: result.mime, data: toBase64(result.bytes) },
  ];
  const instruction =
    "Image 1: original garment. Image 2: result. Assess image 2. Return found (boolean), count (people), box [ymin,xmin,ymax,xmax] of ENTIRE person including clothes, normalised 0..1000; productConcern true if colour, pattern, seams or garment differ; notes short string. " +
    (fabric
      ? "Fabric macro; person is not required."
      : "Do not invent a box if no person is detectable.");
  const r = await fetchImpl("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      model: "gemini-3.8-flash",
      store: false,
      input: [{ type: "text", text: instruction }, ...images],
      response_format: { type: "text", mime_type: "application/json", schema: SCHEMA },
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!r.ok) throw new StudioError(`Review request failed (${r.status}).`, 502);
  const d = (await r.json()) as InteractionResponse;
  if (d.status === "failed") throw new StudioError("Review model could not complete.", 502);
  const text = (d.steps ?? [])
    .filter((s) => s.type === "model_output")
    .flatMap((s) => s.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
  const q = JSON.parse(text) as Omit<QA, "automated">;
  const badBox =
    !Array.isArray(q.box) ||
    q.box.length !== 4 ||
    q.box.some((x) => !Number.isFinite(x) || x < 0 || x > 1000) ||
    q.box[0] >= q.box[2] ||
    q.box[1] >= q.box[3];
  if (q.found && badBox) throw new StudioError("Review returned invalid bounds.", 502);
  const offset = q.found ? Math.abs((q.box[1] + q.box[3]) / 2 - 500) / 10 : 100;
  return {
    ...q,
    offset,
    centered: fabric || (q.found && q.count === 1 && offset <= 1),
    automated: true,
  };
}
