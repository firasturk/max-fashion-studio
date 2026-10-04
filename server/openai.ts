/**
 * OpenAI Images API client for the GPT Image family (gpt-image-2.5-sunburst, gpt-image-2.5-flare, gpt-image-2).
 * Editing is synchronous: POST /v1/images/edits with the reference images as multipart files
 * returns base64 PNG data. Reference images are sent directly, so nothing is uploaded elsewhere.
 */
import { StudioError } from "./errors";

export const OPENAI_MODELS: { slug: string; name: string }[] = [
  { slug: "gpt-image-2.5-sunburst", name: "GPT Image 2.5 Sunburst (OpenAI)" },
  { slug: "gpt-image-2.5-flare", name: "GPT Image 2.5 Flare (OpenAI)" },
  { slug: "gpt-image-2", name: "GPT Image 2 (OpenAI)" },
];

export function isOpenAIModel(slug: string | undefined | null): boolean {
  return !!slug && /^gpt-image/.test(slug);
}

export interface ImageBytes {
  bytes: ArrayBuffer;
  mime: string;
}

export interface OpenAIJob {
  model: string;
  prompt: string;
  images: ImageBytes[];
  /** "2:3" | "3:4" | "4:5" | "1:1" */
  aspectRatio: string;
  /** "1K" | "2K" | "4K" */
  size: string;
}

/**
 * Pixel sizes per aspect ratio and tier. Every edge is a multiple of 16, at most 3840,
 * and the total stays within the model's 655,360 to 8,294,400 pixel window (so "4K" portrait
 * is the largest allowed area at that ratio rather than a 3840 long edge).
 */
export const SIZE_TABLE: Record<string, Record<string, string>> = {
  "2:3": { "1K": "1024x1536", "2K": "1360x2048", "4K": "2352x3520" },
  "3:4": { "1K": "1152x1536", "2K": "1536x2048", "4K": "2480x3312" },
  "4:5": { "1K": "1232x1536", "2K": "1632x2048", "4K": "2576x3216" },
  "1:1": { "1K": "1024x1024", "2K": "2048x2048", "4K": "2880x2880" },
};

const QUALITY: Record<string, string> = { "1K": "medium", "2K": "high", "4K": "xhigh" };

export function pixelSize(aspectRatio: string, size: string): string {
  return SIZE_TABLE[aspectRatio]?.[size] ?? SIZE_TABLE["2:3"]["2K"];
}

async function readError(r: Response): Promise<string> {
  const text = await r.text().catch(() => "");
  try {
    const d = JSON.parse(text) as { error?: { message?: string; code?: string } };
    return d.error?.message || d.error?.code || text.slice(0, 300);
  } catch {
    return text.slice(0, 300);
  }
}

async function openaiError(r: Response): Promise<StudioError> {
  const detail = await readError(r);
  if (r.status === 401) return new StudioError(`OpenAI rejected the API key. ${detail}`, 502, true);
  if (r.status === 402 || /billing|quota|insufficient/i.test(detail))
    return new StudioError(`OpenAI billing problem: ${detail}`, 502, true);
  if (r.status === 403) return new StudioError(`OpenAI refused the request: ${detail}`, 502, true);
  if (r.status === 404) return new StudioError(`OpenAI model not found: ${detail}`, 502, true);
  if (r.status === 429) return new StudioError(`OpenAI rate limit: ${detail}`, 429);
  if (r.status === 400 && /safety|moderation|policy/i.test(detail))
    return new StudioError(`Rejected by OpenAI moderation: ${detail}`, 502);
  return new StudioError(`OpenAI request failed (${r.status}): ${detail}`, 502);
}

function b64ToBytes(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export class OpenAIImageClient {
  private fetchImpl: typeof fetch;

  constructor(
    private apiKey: string,
    private baseUrl = "https://api.openai.com/v1",
    fetchImpl: typeof fetch = fetch,
  ) {
    if (!/^sk-[A-Za-z0-9_-]{10,}$/.test(apiKey))
      throw new StudioError("OpenAI API key should start with sk-.", 400, true);
    this.fetchImpl = (input, init) => fetchImpl(input, init);
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  /** Cheap credential check that also confirms the model exists on this account. */
  async verify(model = "gpt-image-2.5-sunburst"): Promise<{ ok: boolean; message: string }> {
    const r = await this.fetchImpl(`${this.baseUrl}/models/${encodeURIComponent(model)}`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(20_000),
    });
    if (r.ok) return { ok: true, message: `Connected to OpenAI. ${model} is available.` };
    if (r.status === 404)
      return {
        ok: false,
        message: `OpenAI key works but ${model} is not available on this account.`,
      };
    return { ok: false, message: await readError(r) };
  }

  /** Whether a given GPT Image model is available on this account. */
  async hasModel(model: string): Promise<boolean> {
    const r = await this.fetchImpl(`${this.baseUrl}/models/${encodeURIComponent(model)}`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(20_000),
    });
    return r.ok;
  }

  /**
   * Runs an edit and returns the PNG bytes. Takes up to a few minutes at high quality. Optional
   * tuning parameters that a model rejects as unsupported are dropped and the call is retried once.
   */
  async edit(job: OpenAIJob, omit: Set<string> = new Set()): Promise<ImageBytes> {
    const form = new FormData();
    const optional: Record<string, string> = {
      quality: QUALITY[job.size] ?? "high",
      output_format: "png",
      input_fidelity: "high",
    };
    form.append("model", job.model);
    form.append("prompt", job.prompt);
    form.append("n", "1");
    form.append("size", pixelSize(job.aspectRatio, job.size));
    for (const [k, v] of Object.entries(optional)) if (!omit.has(k)) form.append(k, v);
    job.images.forEach((img, i) =>
      form.append(
        "image[]",
        new Blob([img.bytes], { type: img.mime }),
        `ref-${i + 1}.${img.mime.includes("png") ? "png" : "jpg"}`,
      ),
    );
    const r = await this.fetchImpl(`${this.baseUrl}/images/edits`, {
      method: "POST",
      headers: this.headers(),
      body: form,
      signal: AbortSignal.timeout(6 * 60 * 1000),
    });
    if (!r.ok) {
      const err = await openaiError(r);
      const unsupported = Object.keys(optional).find(
        (k) => !omit.has(k) && r.status === 400 && new RegExp(`'${k}'`).test(err.message),
      );
      if (unsupported) return this.edit(job, new Set([...omit, unsupported]));
      throw err;
    }
    const d = (await r.json()) as { data?: { b64_json?: string; url?: string }[] };
    const item = d.data?.[0];
    if (item?.b64_json) return { bytes: b64ToBytes(item.b64_json), mime: "image/png" };
    if (item?.url) {
      const img = await this.fetchImpl(item.url, { signal: AbortSignal.timeout(120_000) });
      if (!img.ok) throw new StudioError("Could not download the OpenAI result.", 502);
      return {
        bytes: await img.arrayBuffer(),
        mime: img.headers.get("content-type")?.split(";")[0] || "image/png",
      };
    }
    throw new StudioError("OpenAI returned no image.", 502);
  }
}
