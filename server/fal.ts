/**
 * fal.ai queue API client for models Higgsfield does not carry (Seedream 5). Submit returns a
 * request id plus status/response URLs; the finaliser polls until the image is ready.
 * Reference images travel as data URIs so nothing has to be made public.
 */
import { StudioError } from "./errors";
import type { ImageBytes } from "./openai";

/** Model slugs carry a `fal/` prefix so the batch config can tell the vendor apart. */
export const FAL_PREFIX = "fal/";

export const FAL_MODELS: { slug: string; name: string }[] = [
  { slug: "fal/bytedance/seedream/v5/pro/edit", name: "Seedream 5.0 Pro (fal.ai)" },
  { slug: "fal/fal-ai/bytedance/seedream/v5/lite/edit", name: "Seedream 5.0 Lite (fal.ai)" },
  { slug: "fal/fal-ai/bytedance/seedream/v4.5/edit", name: "Seedream 4.5 (fal.ai)" },
];

export function isFalModel(slug: string | undefined | null): boolean {
  return !!slug && slug.startsWith(FAL_PREFIX);
}

export function falModelId(slug: string): string {
  return slug.slice(FAL_PREFIX.length);
}

export interface FalJob {
  model: string;
  prompt: string;
  images: ImageBytes[];
  aspectRatio: string;
  size: string;
}

export interface FalHandle {
  requestId: string;
  statusUrl: string;
  responseUrl: string;
}

const QUEUE = "https://queue.fal.run";

/** Output pixel size per frame and tier. Seedream 5 Pro renders up to 2048², so 4K maps to 2K. */
export function falSize(aspectRatio: string, size: string): { width: number; height: number } {
  const long = size === "1K" ? 1536 : 2048;
  const [w, h] = aspectRatio.split(":").map(Number);
  if (!w || !h || w === h) return { width: long, height: long };
  const ratio = w / h;
  const width = ratio < 1 ? Math.round((long * ratio) / 16) * 16 : long;
  const height = ratio < 1 ? long : Math.round(long / ratio / 16) * 16;
  return { width, height };
}

function toBase64(bytes: ArrayBuffer): string {
  let s = "";
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i += 0x8000)
    s += String.fromCharCode(...view.subarray(i, i + 0x8000));
  return btoa(s);
}

async function readError(r: Response): Promise<string> {
  const text = await r.text().catch(() => "");
  try {
    const d = JSON.parse(text) as { detail?: unknown; error?: unknown; message?: unknown };
    const detail = d.detail ?? d.error ?? d.message;
    if (typeof detail === "string") return detail;
    if (detail) return JSON.stringify(detail).slice(0, 300);
  } catch {
    /* not JSON */
  }
  return text.slice(0, 300);
}

async function falError(r: Response): Promise<StudioError> {
  const detail = await readError(r);
  if (r.status === 401 || r.status === 403)
    return new StudioError(`fal.ai rejected the API key: ${detail}`, 502, true);
  if (r.status === 402 || /balance|billing|exhausted/i.test(detail))
    return new StudioError(`fal.ai billing problem: ${detail}`, 502, true);
  if (r.status === 404) return new StudioError(`fal.ai model not found: ${detail}`, 502, true);
  if (r.status === 429) return new StudioError(`fal.ai rate limit: ${detail}`, 429, true);
  if (r.status === 422) return new StudioError(`fal.ai rejected the request: ${detail}`, 502);
  return new StudioError(`fal.ai request failed (${r.status}): ${detail}`, 502);
}

export class FalClient {
  private fetchImpl: typeof fetch;

  constructor(
    private apiKey: string,
    fetchImpl: typeof fetch = fetch,
  ) {
    if (!/^\S{20,}$/.test(apiKey))
      throw new StudioError("fal.ai key looks invalid (too short or contains spaces).", 400, true);
    this.fetchImpl = (input, init) => fetchImpl(input, init);
  }

  private headers(): Record<string, string> {
    return { "Content-Type": "application/json", Authorization: `Key ${this.apiKey}` };
  }

  /**
   * Credential check without spending: an empty submission is refused with 401 on a bad key and
   * with a 422 validation error (missing prompt) on a good one.
   */
  async verify(): Promise<{ ok: boolean; message: string }> {
    const r = await this.fetchImpl(`${QUEUE}/${falModelId(FAL_MODELS[0].slug)}`, {
      method: "POST",
      headers: { ...this.headers(), "X-Fal-No-Retry": "1" },
      body: "{}",
      signal: AbortSignal.timeout(20_000),
    });
    if (r.status === 401 || r.status === 403)
      return { ok: false, message: `API key rejected: ${await readError(r)}` };
    if (r.status === 422 || r.status === 400 || r.ok)
      return { ok: true, message: "Connected to fal.ai." };
    if (r.status === 402) return { ok: false, message: `fal.ai billing: ${await readError(r)}` };
    return { ok: false, message: `Unexpected response ${r.status}: ${await readError(r)}` };
  }

  async submit(job: FalJob): Promise<FalHandle> {
    const r = await this.fetchImpl(`${QUEUE}/${falModelId(job.model)}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        prompt: job.prompt,
        image_urls: job.images.map((img) => `data:${img.mime};base64,${toBase64(img.bytes)}`),
        image_size: falSize(job.aspectRatio, job.size),
        num_images: 1,
        enable_safety_checker: false,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) throw await falError(r);
    const d = (await r.json()) as {
      request_id?: string;
      status_url?: string;
      response_url?: string;
    };
    if (!d.request_id) throw new StudioError("fal.ai did not return a request id.", 502);
    const base = `${QUEUE}/${falModelId(job.model)}/requests/${d.request_id}`;
    return {
      requestId: d.request_id,
      statusUrl: d.status_url || `${base}/status`,
      responseUrl: d.response_url || base,
    };
  }

  async status(
    handle: FalHandle,
  ): Promise<
    | { state: "pending"; raw: string }
    | { state: "done"; image: ImageBytes }
    | { state: "failed"; message: string; retryable: boolean }
  > {
    const r = await this.fetchImpl(handle.statusUrl, {
      headers: this.headers(),
      signal: AbortSignal.timeout(30_000),
    });
    if (r.status === 404)
      return { state: "failed", message: "fal.ai no longer has this request.", retryable: true };
    if (!r.ok) throw await falError(r);
    const s = (await r.json()) as { status?: string; error?: string };
    const status = String(s.status ?? "").toUpperCase();
    if (status !== "COMPLETED") return { state: "pending", raw: status };
    const res = await this.fetchImpl(handle.responseUrl, {
      headers: this.headers(),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 422 || res.status === 500) {
      const detail = await readError(res);
      return {
        state: "failed",
        message: `fal.ai could not complete the request: ${detail}`,
        retryable: !/safety|nsfw|content/i.test(detail),
      };
    }
    if (!res.ok) throw await falError(res);
    const d = (await res.json()) as { images?: { url?: string; content_type?: string }[] };
    const url = d.images?.[0]?.url;
    if (!url) return { state: "failed", message: "fal.ai returned no image.", retryable: true };
    if (url.startsWith("data:")) {
      const [head, b64] = url.split(",", 2);
      const mime = head.slice(5).split(";")[0] || "image/png";
      const bin = atob(b64 ?? "");
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return { state: "done", image: { bytes: out.buffer, mime } };
    }
    const img = await this.fetchImpl(url, { signal: AbortSignal.timeout(120_000) });
    if (!img.ok) throw new StudioError("Could not download the fal.ai result.", 502);
    return {
      state: "done",
      image: {
        bytes: await img.arrayBuffer(),
        mime:
          img.headers.get("content-type")?.split(";")[0] ||
          d.images?.[0]?.content_type ||
          "image/png",
      },
    };
  }
}

/** Serialised request id stored on the task: `fal:` + JSON handle. */
export function encodeFalHandle(h: FalHandle): string {
  return `fal:${JSON.stringify(h)}`;
}

export function decodeFalHandle(requestId: string): FalHandle {
  return JSON.parse(requestId.slice("fal:".length)) as FalHandle;
}
