/**
 * Google Gemini image client for the Nano Banana family through the Interactions API
 * (https://generativelanguage.googleapis.com/v1beta/interactions), as in the original brief:
 * text + inline base64 images in, one image out. Synchronous, like the OpenAI client.
 */
import { StudioError } from "./errors";
import type { ImageBytes } from "./openai";

export const GOOGLE_MODELS: { slug: string; name: string }[] = [
  { slug: "gemini-3-pro-image", name: "Nano Banana Pro (Google)" },
  { slug: "gemini-3.1-flash-image", name: "Nano Banana 2 (Google)" },
  { slug: "gemini-2.5-flash-image", name: "Nano Banana (Google)" },
];

export function isGoogleModel(slug: string | undefined | null): boolean {
  return !!slug && /^gemini/.test(slug);
}

export interface GoogleJob {
  model: string;
  prompt: string;
  images: ImageBytes[];
  aspectRatio: string;
  size: string;
}

const BASE = "https://generativelanguage.googleapis.com/v1beta";

function toBase64(bytes: ArrayBuffer): string {
  let s = "";
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i += 0x8000)
    s += String.fromCharCode(...view.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

async function readError(r: Response): Promise<string> {
  const text = await r.text().catch(() => "");
  try {
    const d = JSON.parse(text) as
      { error?: { message?: string; status?: string } } | { error?: { message?: string } }[];
    const e = Array.isArray(d) ? d[0]?.error : d.error;
    return e?.message || text.slice(0, 300);
  } catch {
    return text.slice(0, 300);
  }
}

async function googleError(r: Response): Promise<StudioError> {
  const detail = await readError(r);
  if (r.status === 400 && /api key/i.test(detail))
    return new StudioError(`Google rejected the API key: ${detail}`, 502, true);
  if (r.status === 401 || r.status === 403)
    return new StudioError(`Google refused the request: ${detail}`, 502, true);
  if (r.status === 404) return new StudioError(`Google model not found: ${detail}`, 502, true);
  if (r.status === 429) return new StudioError(`Google rate limit or quota: ${detail}`, 429, true);
  if (/billing|quota|exceeded/i.test(detail))
    return new StudioError(`Google billing or quota problem: ${detail}`, 502, true);
  return new StudioError(`Google request failed (${r.status}): ${detail}`, 502);
}

interface InteractionResponse {
  status?: string;
  output_image?: string | { data?: string; mime_type?: string };
  steps?: { type?: string; content?: { type?: string; data?: string; mime_type?: string }[] }[];
  outputs?: { type?: string; data?: string; mime_type?: string }[];
  error?: { message?: string };
}

/** Finds the final image wherever the response puts it (output_image, outputs[] or model_output steps). */
export function extractImage(d: InteractionResponse): { data: string; mime: string } | null {
  if (typeof d.output_image === "string") return { data: d.output_image, mime: "image/png" };
  if (d.output_image?.data)
    return { data: d.output_image.data, mime: d.output_image.mime_type || "image/png" };
  const fromOutputs = (d.outputs ?? []).filter((o) => o.type === "image" && o.data).at(-1);
  if (fromOutputs?.data)
    return { data: fromOutputs.data, mime: fromOutputs.mime_type || "image/png" };
  const fromSteps = (d.steps ?? [])
    .filter((s) => s.type === "model_output")
    .flatMap((s) => s.content ?? [])
    .filter((c) => c.type === "image" && c.data)
    .at(-1);
  if (fromSteps?.data) return { data: fromSteps.data, mime: fromSteps.mime_type || "image/png" };
  return null;
}

export class GoogleImageClient {
  private fetchImpl: typeof fetch;

  constructor(
    private apiKey: string,
    fetchImpl: typeof fetch = fetch,
  ) {
    if (!/^[A-Za-z0-9_-]{20,}$/.test(apiKey))
      throw new StudioError("Google AI Studio key looks invalid.", 400, true);
    this.fetchImpl = (input, init) => fetchImpl(input, init);
  }

  private headers(): Record<string, string> {
    return { "Content-Type": "application/json", "x-goog-api-key": this.apiKey };
  }

  /** Confirms the key and that the model is visible to it. */
  async verify(model = "gemini-3-pro-image"): Promise<{ ok: boolean; message: string }> {
    const r = await this.fetchImpl(`${BASE}/models/${encodeURIComponent(model)}`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(20_000),
    });
    if (r.ok) return { ok: true, message: `Connected to Google. ${model} is available.` };
    if (r.status === 404)
      return { ok: false, message: `Google key works but ${model} is not available to it.` };
    return { ok: false, message: await readError(r) };
  }

  async hasModel(model: string): Promise<boolean> {
    const r = await this.fetchImpl(`${BASE}/models/${encodeURIComponent(model)}`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(20_000),
    });
    return r.ok;
  }

  async edit(job: GoogleJob): Promise<ImageBytes> {
    const input: unknown[] = [{ type: "text", text: job.prompt }];
    for (const img of job.images)
      input.push({ type: "image", mime_type: img.mime, data: toBase64(img.bytes) });
    const r = await this.fetchImpl(`${BASE}/interactions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: job.model,
        store: false,
        input,
        response_format: {
          type: "image",
          mime_type: "image/png",
          aspect_ratio: job.aspectRatio,
          image_size: job.size.toUpperCase(),
        },
      }),
      signal: AbortSignal.timeout(5 * 60 * 1000),
    });
    if (!r.ok) throw await googleError(r);
    const d = (await r.json()) as InteractionResponse;
    if (d.status === "failed")
      throw new StudioError(
        `Google could not complete the request. ${d.error?.message ?? ""}`.trim(),
        502,
      );
    const img = extractImage(d);
    if (!img)
      throw new StudioError(
        "Google returned no image. Adjust the prompt or check model restrictions.",
        502,
      );
    return { bytes: fromBase64(img.data), mime: img.mime };
  }
}
