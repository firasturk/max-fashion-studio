/**
 * Batch engine: moves tasks through queued -> processing -> finalizing -> ready/review/failed.
 * It is driven from three places with the same function: the client's periodic tick,
 * the engine webhook, and the Worker cron trigger, so a batch keeps moving with the tab closed.
 * Every state transition is an atomic conditional UPDATE, so concurrent drivers never
 * submit the same task twice or store the same result twice.
 */
import type { Env } from "./env";
import { concurrency } from "./env";
import { all, first, run, now, uuid } from "./db";
import { HiggsfieldClient, downloadImage, type GenerationJob } from "./higgsfield";
import { inspectWithGemini, manualQA } from "./gemini";
import { StudioError, errorMessage, isFatalEngineError } from "./errors";
import { buildPrompt, buildEditorialPrompt, RECENTER_SUFFIX } from "@shared/prompts";
import { buildBriefWithGoogle, buildBriefWithOpenAI, type EditorialBrief } from "./editorial";
import { FABRIC_CARD, type Config } from "@shared/config";
import type { QA } from "@shared/types";
import {
  resolveEngineKey,
  resolveEngineModel,
  resolveOpenAIKey,
  resolveGoogleKey,
} from "./settings";
import { GoogleImageClient, isGoogleModel } from "./google";
import { OpenAIImageClient, isOpenAIModel, type ImageBytes } from "./openai";

interface BatchRow {
  id: string;
  owner: string;
  config: string;
  state: string;
}

interface TaskRow {
  id: string;
  batch: string;
  source: string;
  card: number;
  status: string;
  output: string | null;
  output_engine_url: string | null;
  edit: string | null;
  attempts: number;
  recenter: number;
  request_id: string | null;
  leased_at: number | null;
  prompt: string;
  brief: string | null;
}

interface SourceRow {
  id: string;
  name: string;
  key: string;
  reference_key: string | null;
  mime: string;
  engine_url: string | null;
}

const SUBMIT_TIMEOUT_MS = 10 * 60 * 1000; // processing without a request id for this long = lost
const ENGINE_TIMEOUT_MS = 45 * 60 * 1000; // engine still pending after this = give up
const OPENAI_TIMEOUT_MS = 12 * 60 * 1000; // a synchronous OpenAI edit is lost after this
const MAX_AUTO_ATTEMPTS = 2; // one automatic retry for transient engine failures / off-centre

export function keyLooksValid(key: string | null | undefined): key is string {
  return !!key && /^[^:\s]+:[^:\s]+$/.test(key);
}

export async function engineConfigured(env: Env): Promise<boolean> {
  return keyLooksValid((await resolveEngineKey(env)).key);
}

export async function makeClient(
  env: Env,
  key?: string,
  model?: string,
): Promise<HiggsfieldClient> {
  const apiKey = key ?? (await resolveEngineKey(env)).key;
  if (!apiKey)
    throw new StudioError("Higgsfield is not connected. Add the API key in Connection.", 428, true);
  return new HiggsfieldClient({
    apiKey,
    baseUrl: env.HIGGSFIELD_BASE_URL || "https://api.higgsfield.ai",
    model: model || (await resolveEngineModel(env)),
  });
}

function webhookUrl(env: Env, batchId: string): string | undefined {
  if (!env.PUBLIC_BASE_URL || !env.WEBHOOK_TOKEN) return undefined;
  const u = new URL("/api/hooks/engine", env.PUBLIC_BASE_URL);
  u.searchParams.set("token", env.WEBHOOK_TOKEN);
  u.searchParams.set("batch", batchId);
  return u.toString();
}

export type Background = (p: Promise<unknown>) => void;

export async function makeGoogleClient(env: Env, key?: string): Promise<GoogleImageClient> {
  const apiKey = key ?? (await resolveGoogleKey(env)).key;
  if (!apiKey)
    throw new StudioError("Google is not connected. Add the API key in Connection.", 428, true);
  return new GoogleImageClient(apiKey);
}

export async function makeOpenAIClient(env: Env, key?: string): Promise<OpenAIImageClient> {
  const apiKey = key ?? (await resolveOpenAIKey(env)).key;
  if (!apiKey)
    throw new StudioError("OpenAI is not connected. Add the API key in Connection.", 428, true);
  return new OpenAIImageClient(apiKey);
}

/**
 * Advance one batch as far as it can go right now. Safe to call concurrently.
 * `background` (waitUntil) lets synchronous engines finish after the HTTP response; without it they run inline.
 */
export async function advanceBatch(
  env: Env,
  batchId: string,
  background?: Background,
): Promise<void> {
  const batch = await first<BatchRow>(
    env.DB,
    "SELECT id, owner, config, state FROM batches WHERE id = ?",
    batchId,
  );
  if (!batch) return;
  const config = JSON.parse(batch.config) as Config;

  await finalizeInFlight(env, batch, config);

  if (batch.state === "running") {
    await submitNext(env, batch, config, background);
    await settleIdle(env, batch, config);
  }
}

async function finalizeInFlight(env: Env, batch: BatchRow, config: Config): Promise<void> {
  const inflight = await all<TaskRow>(
    env.DB,
    "SELECT * FROM tasks WHERE batch = ? AND status = 'processing' ORDER BY leased_at",
    batch.id,
  );
  if (!inflight.length) return;
  const client = (await engineConfigured(env)) ? await makeClient(env) : null;

  for (const task of inflight) {
    const age = now() - (task.leased_at ?? now());
    if (!task.request_id) {
      if (age > SUBMIT_TIMEOUT_MS)
        await failTask(env, task, "Submission was interrupted. Retry this image.", task.output);
      continue;
    }
    if (task.request_id.startsWith("openai:") || task.request_id.startsWith("sync:")) {
      // Synchronous engine: the background job finalises the task itself; only guard against a lost isolate.
      if (age > OPENAI_TIMEOUT_MS)
        await failTask(
          env,
          task,
          "The OpenAI generation did not finish in time. Retry this image.",
          task.output,
        );
      continue;
    }
    if (!client) continue;
    let status;
    try {
      status = await client.status(task.request_id);
    } catch (e) {
      // A transient status error is retried on the next tick; a fatal one pauses the batch.
      if (isFatalEngineError(e)) await pauseBatch(env, batch.id, errorMessage(e));
      continue;
    }
    if (status.state === "pending") {
      if (age > ENGINE_TIMEOUT_MS)
        await failTask(
          env,
          task,
          "The engine did not finish in time. Retry this image.",
          task.output,
        );
      continue;
    }
    if (status.state === "failed") {
      if (status.retryable && task.attempts < MAX_AUTO_ATTEMPTS)
        await requeue(env, task, status.message);
      else await failTask(env, task, status.message, task.output);
      continue;
    }
    // Claim the finalisation so a concurrent driver does not download and store the same image.
    const claimed = await run(
      env.DB,
      "UPDATE tasks SET status = 'finalizing', updated = ? WHERE id = ? AND status = 'processing' AND request_id = ?",
      now(),
      task.id,
      task.request_id,
    );
    if (!claimed) continue;
    try {
      await storeResult(env, batch, config, task, status.url);
    } catch (e) {
      // Put it back so the next tick retries the download; the engine result still exists.
      await run(
        env.DB,
        "UPDATE tasks SET status = 'processing', error = ?, updated = ? WHERE id = ? AND status = 'finalizing'",
        errorMessage(e, "Could not store the result."),
        now(),
        task.id,
      );
    }
  }
}

async function storeResult(
  env: Env,
  batch: BatchRow,
  config: Config,
  task: TaskRow,
  url: string,
): Promise<void> {
  await storeResultBytes(env, batch, config, task, await downloadImage(url), url);
}

async function storeResultBytes(
  env: Env,
  batch: BatchRow,
  config: Config,
  task: TaskRow,
  result: ImageBytes,
  url: string | null,
): Promise<void> {
  const ext = /jpe?g/i.test(result.mime) ? "jpg" : /webp/i.test(result.mime) ? "webp" : "png";
  const key = `${batch.owner}/${batch.id}/output/${task.id}/${uuid()}.${ext}`;
  await env.BUCKET.put(key, result.bytes, {
    httpMetadata: { contentType: result.mime || "image/png" },
  });

  let qa: QA;
  const reviewKey = (await resolveGoogleKey(env)).key;
  if (reviewKey) {
    try {
      const source = await first<SourceRow>(
        env.DB,
        "SELECT * FROM sources WHERE id = ?",
        task.source,
      );
      const ref = source ? await env.BUCKET.get(source.reference_key || source.key) : null;
      if (!ref) throw new StudioError("Original unavailable for review.");
      qa = await inspectWithGemini(
        reviewKey,
        { bytes: await ref.arrayBuffer(), mime: ref.httpMetadata?.contentType || "image/jpeg" },
        result,
        task.card === FABRIC_CARD,
      );
    } catch (e) {
      qa = manualQA(`Automatic review unavailable (${errorMessage(e)}). Check manually.`);
    }
  } else {
    qa = manualQA();
  }

  const wantsCenter = config.center && task.card !== FABRIC_CARD;
  const offCentre = wantsCenter && qa.automated && qa.found && !qa.centered;
  if (offCentre && task.attempts < MAX_AUTO_ATTEMPTS && !task.edit) {
    // Keep this result visible, but queue exactly one centering retry.
    await run(
      env.DB,
      "UPDATE tasks SET status = 'queued', output = ?, output_engine_url = ?, qa = ?, recenter = 1, request_id = NULL, lease = NULL, error = NULL, updated = ? WHERE id = ?",
      key,
      url,
      JSON.stringify(qa),
      now(),
      task.id,
    );
    return;
  }

  const status = qa.automated
    ? qa.productConcern || (wantsCenter && !qa.centered)
      ? "review"
      : "ready"
    : "review";
  await run(
    env.DB,
    "UPDATE tasks SET status = ?, output = ?, output_engine_url = ?, qa = ?, edit = NULL, recenter = 0, request_id = NULL, lease = NULL, leased_at = NULL, error = NULL, updated = ? WHERE id = ?",
    status,
    key,
    url,
    JSON.stringify(qa),
    now(),
    task.id,
  );
}

async function failTask(
  env: Env,
  task: TaskRow,
  message: string,
  previousOutput: string | null,
): Promise<void> {
  // A failed revision keeps the previous result visible; a failed first generation shows as failed.
  const status = previousOutput ? (task.edit || task.recenter ? "review" : "failed") : "failed";
  await run(
    env.DB,
    "UPDATE tasks SET status = ?, error = ?, edit = NULL, recenter = 0, request_id = NULL, lease = NULL, leased_at = NULL, updated = ? WHERE id = ? AND status IN ('processing','finalizing')",
    status,
    message.slice(0, 500),
    now(),
    task.id,
  );
}

async function requeue(env: Env, task: TaskRow, message: string): Promise<void> {
  await run(
    env.DB,
    "UPDATE tasks SET status = 'queued', error = ?, request_id = NULL, lease = NULL, leased_at = NULL, updated = ? WHERE id = ? AND status = 'processing'",
    `Retrying: ${message}`.slice(0, 500),
    now(),
    task.id,
  );
}

export async function pauseBatch(env: Env, batchId: string, reason: string | null): Promise<void> {
  await run(
    env.DB,
    "UPDATE batches SET state = 'paused', last_error = ?, updated = ? WHERE id = ?",
    reason ? reason.slice(0, 500) : null,
    now(),
    batchId,
  );
}

/** Tasks that may start now: card 1 and the fabric card always; cards 2-5 once card 1 has a result. */
async function eligibleQueued(
  env: Env,
  batch: BatchRow,
  config: Config,
  limit: number,
): Promise<TaskRow[]> {
  const queued = await all<TaskRow & { source_name: string }>(
    env.DB,
    "SELECT t.*, s.name AS source_name FROM tasks t JOIN sources s ON s.id = t.source WHERE t.batch = ? AND t.status = 'queued' ORDER BY s.name, t.card",
    batch.id,
  );
  if (config.mode !== "1") return queued.slice(0, limit);
  const out: TaskRow[] = [];
  for (const t of queued) {
    if (t.card === 1 || t.card === FABRIC_CARD) {
      out.push(t);
    } else {
      const firstCard = await first<{ status: string; output: string | null }>(
        env.DB,
        "SELECT status, output FROM tasks WHERE batch = ? AND source = ? AND card = 1",
        batch.id,
        t.source,
      );
      const ready = (r: { status: string; output: string | null } | null) =>
        !!r?.output && !["processing", "finalizing", "queued"].includes(r.status);
      if (!ready(firstCard)) continue;
      if (t.card > 2) {
        const studioCard = await first<{ status: string; output: string | null }>(
          env.DB,
          "SELECT status, output FROM tasks WHERE batch = ? AND source = ? AND card = 2",
          batch.id,
          t.source,
        );
        if (!ready(studioCard)) continue;
      }
      out.push(t);
    }
    if (out.length >= limit) break;
  }
  return out;
}

async function submitNext(
  env: Env,
  batch: BatchRow,
  config: Config,
  background?: Background,
): Promise<void> {
  const openai = isOpenAIModel(config.model);
  const google = isGoogleModel(config.model);
  if (openai) {
    if (!(await resolveOpenAIKey(env)).key) {
      await pauseBatch(
        env,
        batch.id,
        "OpenAI is not connected. Add the API key in Connection and resume.",
      );
      return;
    }
  } else if (google) {
    if (!(await resolveGoogleKey(env)).key) {
      await pauseBatch(
        env,
        batch.id,
        "Google is not connected. Add the API key in Connection and resume.",
      );
      return;
    }
  } else if (!(await engineConfigured(env))) {
    await pauseBatch(
      env,
      batch.id,
      "Higgsfield is not connected. Add the API key in Connection and resume.",
    );
    return;
  }
  const processing = await first<{ n: number }>(
    env.DB,
    "SELECT COUNT(*) AS n FROM tasks WHERE batch = ? AND status IN ('processing','finalizing')",
    batch.id,
  );
  const slots = concurrency(env) - (processing?.n ?? 0);
  if (slots <= 0) return;
  const candidates = await eligibleQueued(env, batch, config, slots);
  const client = openai || google ? null : await makeClient(env, undefined, config.model);

  for (const task of candidates) {
    const token = uuid();
    const claimed = await run(
      env.DB,
      "UPDATE tasks SET status = 'processing', lease = ?, leased_at = ?, request_id = NULL, attempts = attempts + 1, updated = ? WHERE id = ? AND status = 'queued'",
      token,
      now(),
      now(),
      task.id,
    );
    if (!claimed) continue;
    try {
      const requestId = client
        ? await submitTask(env, client, batch, config, task)
        : await submitOpenAITask(env, batch, config, task, token, background);
      await run(
        env.DB,
        "UPDATE tasks SET request_id = ?, updated = ? WHERE id = ? AND lease = ?",
        requestId,
        now(),
        task.id,
        token,
      );
    } catch (e) {
      await failTask(
        env,
        { ...task, status: "processing" },
        errorMessage(e, "Generation failed."),
        task.output,
      );
      if (isFatalEngineError(e)) {
        await pauseBatch(env, batch.id, errorMessage(e));
        return;
      }
    }
  }
}

/** Upload the inference reference once per source and cache the engine URL. */
async function sourceEngineUrl(
  env: Env,
  client: HiggsfieldClient,
  source: SourceRow,
): Promise<string> {
  if (source.engine_url) return source.engine_url;
  const obj =
    (await env.BUCKET.get(source.reference_key || source.key)) ??
    (await env.BUCKET.get(source.key));
  if (!obj) throw new StudioError("Original unavailable.", 404);
  const url = await client.upload(
    await obj.arrayBuffer(),
    obj.httpMetadata?.contentType || source.mime,
  );
  await run(env.DB, "UPDATE sources SET engine_url = ? WHERE id = ?", url, source.id);
  return url;
}

async function identityEngineUrl(
  env: Env,
  client: HiggsfieldClient,
  owner: string,
  identityId: string,
): Promise<string> {
  const row = await first<{ id: string; key: string; engine_url: string | null }>(
    env.DB,
    "SELECT id, key, engine_url FROM identities WHERE id = ? AND owner = ?",
    identityId,
    owner,
  );
  if (!row) throw new StudioError("Identity reference unavailable.", 404);
  if (row.engine_url) return row.engine_url;
  const obj = await env.BUCKET.get(row.key);
  if (!obj) throw new StudioError("Identity reference unavailable.", 404);
  const url = await client.upload(
    await obj.arrayBuffer(),
    obj.httpMetadata?.contentType || "image/jpeg",
  );
  await run(env.DB, "UPDATE identities SET engine_url = ? WHERE id = ?", url, row.id);
  return url;
}

/** Latest stored result as an engine URL: the cached CDN URL, or a fresh upload from R2. */
async function outputEngineUrl(
  env: Env,
  client: HiggsfieldClient,
  task: Pick<TaskRow, "id" | "output" | "output_engine_url">,
): Promise<string> {
  if (task.output_engine_url) return task.output_engine_url;
  if (!task.output) throw new StudioError("Result unavailable.", 404);
  const obj = await env.BUCKET.get(task.output);
  if (!obj) throw new StudioError("Result unavailable.", 404);
  const url = await client.upload(
    await obj.arrayBuffer(),
    obj.httpMetadata?.contentType || "image/png",
  );
  await run(env.DB, "UPDATE tasks SET output_engine_url = ? WHERE id = ?", url, task.id);
  return url;
}

/** Runs the prompt-builder skill once per card and stores the brief; revisions and retries reuse it. */
async function ensureBrief(
  env: Env,
  batch: BatchRow,
  config: Config,
  task: TaskRow,
  source: SourceRow,
): Promise<EditorialBrief> {
  if (task.brief) return JSON.parse(task.brief) as EditorialBrief;
  const image = await sourceBytes(env, source);
  const siblings = await all<{ card: number; brief: string | null }>(
    env.DB,
    "SELECT card, brief FROM tasks WHERE batch = ? AND source = ? AND id != ? AND brief IS NOT NULL ORDER BY card",
    batch.id,
    task.source,
    task.id,
  );
  const used = siblings.map((t) => {
    const b = JSON.parse(t.brief!) as EditorialBrief;
    return { scene: b.scene, pose: b.pose };
  });
  const req = {
    image,
    run: task.card,
    market: config.market || "auto",
    preference: config.prompt,
    aspectRatio: config.ratio,
    used,
  };
  // The builder follows the image engine's vendor when possible (OpenAI model -> OpenAI builder),
  // so one key is enough and errors come from a single provider.
  const google = (await resolveGoogleKey(env)).key;
  const openai = (await resolveOpenAIKey(env)).key;
  if (!google && !openai)
    throw new StudioError(
      "The editorial prompt builder needs a Google or OpenAI key in Connection.",
      428,
      true,
    );
  const preferOpenAI = isOpenAIModel(config.model) ? !!openai : !google;
  const brief = preferOpenAI
    ? await buildBriefWithOpenAI(openai!, req)
    : await buildBriefWithGoogle(google!, req);
  await run(env.DB, "UPDATE tasks SET brief = ? WHERE id = ?", JSON.stringify(brief), task.id);
  return brief;
}

/** Prompt for a card: the editorial brief in mode 5, the deterministic builder otherwise. */
async function promptFor(
  env: Env,
  batch: BatchRow,
  config: Config,
  task: TaskRow,
  source: SourceRow,
  edit: string,
  roles: { identity: boolean; firstCard: boolean; studio: boolean; revision: boolean },
): Promise<string> {
  let prompt: string;
  if (config.mode === "5") {
    const brief = await ensureBrief(env, batch, config, task, source);
    prompt = buildEditorialPrompt(brief.prompt, brief.negative, edit, roles);
  } else {
    prompt = buildPrompt(config, task.card, edit, roles);
  }
  if (task.recenter) prompt += `\n\n${RECENTER_SUFFIX}`;
  await run(env.DB, "UPDATE tasks SET prompt = ? WHERE id = ?", prompt, task.id);
  return prompt;
}

async function submitTask(
  env: Env,
  client: HiggsfieldClient,
  batch: BatchRow,
  config: Config,
  task: TaskRow,
): Promise<string> {
  const source = await first<SourceRow>(env.DB, "SELECT * FROM sources WHERE id = ?", task.source);
  if (!source) throw new StudioError("Original unavailable.", 404);
  const imageUrls = [await sourceEngineUrl(env, client, source)];
  const roles = { identity: false, firstCard: false, studio: false, revision: false };

  if (config.mode === "3" && config.identity) {
    imageUrls.push(await identityEngineUrl(env, client, batch.owner, config.identity));
    roles.identity = true;
  }
  if (config.mode === "1" && task.card > 1 && task.card < FABRIC_CARD) {
    const firstCard = await first<TaskRow>(
      env.DB,
      "SELECT id, output, output_engine_url FROM tasks WHERE batch = ? AND source = ? AND card = 1",
      batch.id,
      task.source,
    );
    if (!firstCard?.output)
      throw new StudioError(
        "Generate lifestyle card 1 first to establish the model identity.",
        409,
      );
    imageUrls.push(await outputEngineUrl(env, client, firstCard));
    roles.firstCard = true;
    if (task.card > 2) {
      const studioCard = await first<TaskRow>(
        env.DB,
        "SELECT id, output, output_engine_url FROM tasks WHERE batch = ? AND source = ? AND card = 2",
        batch.id,
        task.source,
      );
      if (studioCard?.output) {
        imageUrls.push(await outputEngineUrl(env, client, studioCard));
        roles.studio = true;
      }
    }
  }
  const edit = task.edit?.trim() ?? "";
  if ((edit || task.recenter) && task.output) {
    imageUrls.push(await outputEngineUrl(env, client, task));
    roles.revision = true;
  }

  const prompt = await promptFor(env, batch, config, task, source, edit, roles);

  const job: GenerationJob = {
    prompt,
    imageUrls,
    aspectRatio: config.ratio,
    size: config.size,
    webhookUrl: webhookUrl(env, batch.id),
  };
  return client.submit(job);
}

/** Bytes of the inference reference for a source (downsized JPEG when available). */
async function sourceBytes(env: Env, source: SourceRow): Promise<ImageBytes> {
  const obj =
    (await env.BUCKET.get(source.reference_key || source.key)) ??
    (await env.BUCKET.get(source.key));
  if (!obj) throw new StudioError("Original unavailable.", 404);
  return { bytes: await obj.arrayBuffer(), mime: obj.httpMetadata?.contentType || source.mime };
}

async function outputBytes(env: Env, task: Pick<TaskRow, "output">): Promise<ImageBytes> {
  if (!task.output) throw new StudioError("Result unavailable.", 404);
  const obj = await env.BUCKET.get(task.output);
  if (!obj) throw new StudioError("Result unavailable.", 404);
  return { bytes: await obj.arrayBuffer(), mime: obj.httpMetadata?.contentType || "image/png" };
}

/**
 * OpenAI edits are synchronous, so the generation runs as a background job that finalises
 * the task itself. The returned request id marks the task as in flight for the finaliser.
 */
async function submitOpenAITask(
  env: Env,
  batch: BatchRow,
  config: Config,
  task: TaskRow,
  lease: string,
  background?: Background,
): Promise<string> {
  const source = await first<SourceRow>(env.DB, "SELECT * FROM sources WHERE id = ?", task.source);
  if (!source) throw new StudioError("Original unavailable.", 404);
  const images: ImageBytes[] = [await sourceBytes(env, source)];
  const roles = { identity: false, firstCard: false, studio: false, revision: false };

  if (config.mode === "1" && task.card > 1 && task.card < FABRIC_CARD) {
    const firstCard = await first<TaskRow>(
      env.DB,
      "SELECT id, output, output_engine_url FROM tasks WHERE batch = ? AND source = ? AND card = 1",
      batch.id,
      task.source,
    );
    if (!firstCard?.output)
      throw new StudioError(
        "Generate lifestyle card 1 first to establish the model identity.",
        409,
      );
    images.push(await outputBytes(env, firstCard));
    roles.firstCard = true;
    if (task.card > 2) {
      const studioCard = await first<TaskRow>(
        env.DB,
        "SELECT id, output FROM tasks WHERE batch = ? AND source = ? AND card = 2",
        batch.id,
        task.source,
      );
      if (studioCard?.output) {
        images.push(await outputBytes(env, studioCard));
        roles.studio = true;
      }
    }
  }
  const edit = task.edit?.trim() ?? "";
  if ((edit || task.recenter) && task.output) {
    images.push(await outputBytes(env, task));
    roles.revision = true;
  }

  const prompt = await promptFor(env, batch, config, task, source, edit, roles);

  const requestId = `sync:${uuid()}`;
  // Record the id before the slow call so a concurrent driver sees the task as in flight.
  await run(
    env.DB,
    "UPDATE tasks SET request_id = ?, updated = ? WHERE id = ? AND lease = ?",
    requestId,
    now(),
    task.id,
    lease,
  );

  const client = isGoogleModel(config.model)
    ? await makeGoogleClient(env)
    : await makeOpenAIClient(env);
  const job = (async () => {
    try {
      const result = await client.edit({
        model: config.model!,
        prompt,
        images,
        aspectRatio: config.ratio,
        size: config.size,
      });
      const claimed = await run(
        env.DB,
        "UPDATE tasks SET status = 'finalizing', updated = ? WHERE id = ? AND status = 'processing' AND request_id = ?",
        now(),
        task.id,
        requestId,
      );
      if (!claimed) return;
      await storeResultBytes(
        env,
        batch,
        config,
        { ...task, status: "finalizing", request_id: requestId },
        result,
        null,
      );
    } catch (e) {
      await failTask(
        env,
        { ...task, status: "processing", request_id: requestId },
        errorMessage(e, "Generation failed."),
        task.output,
      );
      if (isFatalEngineError(e)) await pauseBatch(env, batch.id, errorMessage(e));
    }
  })();
  if (background) background(job);
  else await job;
  return requestId;
}

/** A running batch goes back to idle when nothing is in flight and nothing else can start (e.g. cards 2-5 whose card 1 failed). */
async function settleIdle(env: Env, batch: BatchRow, config: Config): Promise<void> {
  const inflight = await first<{ n: number }>(
    env.DB,
    "SELECT COUNT(*) AS n FROM tasks WHERE batch = ? AND status IN ('processing','finalizing')",
    batch.id,
  );
  if ((inflight?.n ?? 0) > 0) return;
  const startable = await eligibleQueued(env, batch, config, 1);
  if (startable.length) return;
  await run(
    env.DB,
    "UPDATE batches SET state = 'idle', updated = ? WHERE id = ? AND state = 'running'",
    now(),
    batch.id,
  );
}

/** Batches the cron trigger should look at. */
export async function activeBatchIds(env: Env): Promise<string[]> {
  const rows = await all<{ id: string }>(
    env.DB,
    "SELECT DISTINCT b.id FROM batches b LEFT JOIN tasks t ON t.batch = b.id AND t.status IN ('processing','finalizing') WHERE b.state = 'running' OR t.id IS NOT NULL LIMIT 50",
  );
  return rows.map((r) => r.id);
}
