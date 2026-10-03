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
import { manualQA, reviewWithGoogle, reviewWithOpenAI } from "./review";
import { estimateCost } from "@shared/pricing";
import { notify } from "./notify";
import { StudioError, errorMessage, isFatalEngineError, isTransientEngineError } from "./errors";
import {
  buildPrompt,
  buildEditorialPrompt,
  RECENTER_SUFFIX,
  type PromptImages,
} from "@shared/prompts";
import {
  buildBriefWithGoogle,
  buildBriefWithOpenAI,
  planRun,
  type EditorialBrief,
  type EditorialRequest,
} from "./editorial";
import { FABRIC_CARD, type Config } from "@shared/config";
import type { QA } from "@shared/types";
import {
  getSetting,
  resolveEngineKey,
  resolveEngineModel,
  resolveFalKey,
  resolveGoogleKey,
  resolveOpenAIKey,
  setSetting,
} from "./settings";
import { GoogleImageClient, isGoogleModel } from "./google";
import { FalClient, decodeFalHandle, encodeFalHandle, isFalModel } from "./fal";
import { sanitizePrompt } from "@shared/safety";
import { productKey } from "@shared/naming";
import { resolveSkill } from "./skills";
import { centeringApplies } from "@shared/prompts";
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
  updated: number;
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
const FINALIZE_TIMEOUT_MS = 5 * 60 * 1000; // finalizing this long = the saving job was cut off
const GOOGLE_TIMEOUT_MS = 20 * 60 * 1000; // a standard-tier Google generation still pending after this = give up
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

/**
 * How a driver wants synchronous engines (OpenAI, Google standard tier) handled. Their generation
 * runs inside the Worker, and a request's waitUntil is cut off ~30 s after the response, so only
 * a driver that keeps its connection open (the client tick, held until the jobs settle) or the
 * cron (15 min budget) may start them. Quick mutations defer them to the next tick.
 */
export interface DriveOptions {
  background?: Background;
  deferSync?: boolean;
}

export async function makeGoogleClient(env: Env, key?: string): Promise<GoogleImageClient> {
  const apiKey = key ?? (await resolveGoogleKey(env)).key;
  if (!apiKey)
    throw new StudioError("Google is not connected. Add the API key in Connection.", 428, true);
  return new GoogleImageClient(apiKey);
}

export async function makeFalClient(env: Env, key?: string): Promise<FalClient> {
  const apiKey = key ?? (await resolveFalKey(env)).key;
  if (!apiKey)
    throw new StudioError("fal.ai is not connected. Add the API key in Connection.", 428, true);
  return new FalClient(apiKey);
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
  options: DriveOptions = {},
): Promise<void> {
  const batch = await first<BatchRow>(
    env.DB,
    "SELECT id, owner, config, state FROM batches WHERE id = ?",
    batchId,
  );
  if (!batch) return;
  const config = JSON.parse(batch.config) as Config;
  // A batch saved without a model means "the default at the time it runs"; routing (Google /
  // OpenAI / Higgsfield) keys off the slug, so resolve it before anything looks at it.
  if (!config.model) config.model = await resolveEngineModel(env);

  await finalizeInFlight(env, batch, config);

  if (batch.state === "running") {
    await submitNext(env, batch, config, options);
    await settleIdle(env, batch, config);
  }
}

async function finalizeInFlight(env: Env, batch: BatchRow, config: Config): Promise<void> {
  const inflight = await all<TaskRow>(
    env.DB,
    "SELECT * FROM tasks WHERE batch = ? AND status IN ('processing','finalizing') ORDER BY leased_at",
    batch.id,
  );
  if (!inflight.length) return;
  const client = (await engineConfigured(env)) ? await makeClient(env) : null;

  for (const task of inflight) {
    const age = now() - (task.leased_at ?? now());
    if (task.status === "finalizing") {
      // A saving job that never reported back (the isolate was evicted mid-way). Synchronous
      // engines lose the bytes, so the task fails with its previous result kept; polled engines
      // still hold the image, so the task goes back to processing and is fetched again.
      if (now() - task.updated < FINALIZE_TIMEOUT_MS) continue;
      if (!task.request_id || task.request_id.startsWith("sync:"))
        await failTask(
          env,
          task,
          "Saving the result was interrupted. Retry this image.",
          task.output,
        );
      else
        await run(
          env.DB,
          "UPDATE tasks SET status = 'processing', updated = ? WHERE id = ? AND status = 'finalizing'",
          now(),
          task.id,
        );
      continue;
    }
    if (!task.request_id) {
      if (age > SUBMIT_TIMEOUT_MS)
        await failTask(env, task, "Submission was interrupted. Retry this image.", task.output);
      continue;
    }
    if (task.request_id.startsWith("google:")) {
      await finalizeGoogleFlex(env, batch, config, task);
      continue;
    }
    if (task.request_id.startsWith("fal:")) {
      await finalizeFal(env, batch, config, task);
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
  // Save the image before the (slow) automatic review so an evicted isolate never loses a paid
  // result; the review then upgrades the status if it is still waiting for it.
  await run(
    env.DB,
    "UPDATE tasks SET status = 'review', output = ?, output_engine_url = ?, qa = ?, edit = NULL, recenter = 0, request_id = NULL, lease = NULL, leased_at = NULL, error = NULL, updated = ? WHERE id = ? AND status = 'finalizing'",
    key,
    url,
    JSON.stringify(manualQA("Automatic review still running. Check manually.")),
    now(),
    task.id,
  );

  let qa: QA;
  const googleKey = (await resolveGoogleKey(env)).key;
  const openaiKey = googleKey ? null : (await resolveOpenAIKey(env)).key;
  if (googleKey || openaiKey) {
    try {
      const source = await first<SourceRow>(
        env.DB,
        "SELECT * FROM sources WHERE id = ?",
        task.source,
      );
      if (!source) throw new StudioError("Original unavailable for review.");
      const ref = await sourceBytes(env, source);
      // Studio cards must show the same face as card 1.
      let identity: ImageBytes | undefined;
      if (config.mode === "1" && task.card > 1 && task.card < FABRIC_CARD) {
        const firstCard = await first<{ output: string | null }>(
          env.DB,
          "SELECT output FROM tasks WHERE batch = ? AND source = ? AND card = 1",
          batch.id,
          task.source,
        );
        if (firstCard?.output) identity = await outputBytes(env, firstCard);
      }
      try {
        qa = googleKey
          ? await reviewWithGoogle(googleKey, ref, result, task.card === FABRIC_CARD, identity)
          : await reviewWithOpenAI(openaiKey!, ref, result, task.card === FABRIC_CARD, identity);
      } catch (e) {
        const oa = googleKey ? (await resolveOpenAIKey(env)).key : null;
        if (oa && googleUnavailable(e))
          qa = await reviewWithOpenAI(oa, ref, result, task.card === FABRIC_CARD, identity);
        else throw e;
      }
    } catch (e) {
      qa = manualQA(`Automatic review unavailable (${errorMessage(e)}). Check manually.`);
    }
  } else {
    qa = manualQA();
  }

  const wantsCenter = centeringApplies(config, task.card);
  const offCentre = wantsCenter && qa.automated && qa.found && !qa.centered;
  if (offCentre && task.attempts < MAX_AUTO_ATTEMPTS && !task.edit) {
    // Keep this result visible, but queue exactly one centering retry.
    await run(
      env.DB,
      "UPDATE tasks SET status = 'queued', qa = ?, recenter = 1, updated = ? WHERE id = ? AND status = 'review' AND output = ?",
      JSON.stringify(qa),
      now(),
      task.id,
      key,
    );
    return;
  }

  const status = qa.automated
    ? qa.productConcern || qa.sameFace === false || (wantsCenter && !qa.centered)
      ? "review"
      : "ready"
    : "review";
  // Only while nobody approved or re-queued it in the meantime.
  await run(
    env.DB,
    "UPDATE tasks SET status = ?, qa = ?, updated = ? WHERE id = ? AND status = 'review' AND output = ?",
    status,
    JSON.stringify(qa),
    now(),
    task.id,
    key,
  );
}

async function failTask(
  env: Env,
  task: TaskRow,
  message: string,
  previousOutput: string | null,
): Promise<void> {
  // Any earlier result stays visible for review; only a task with nothing to show is marked failed.
  const status = previousOutput ? "review" : "failed";
  await run(
    env.DB,
    "UPDATE tasks SET status = ?, error = ?, edit = NULL, recenter = 0, request_id = NULL, lease = NULL, leased_at = NULL, updated = ? WHERE id = ? AND status IN ('processing','finalizing')",
    status,
    message.slice(0, 500),
    now(),
    task.id,
  );
}

/**
 * A generation attempt that threw: the engine produced nothing, so the recorded attempt cost is
 * refunded; a transient failure gets one automatic retry, anything else fails the task.
 */
async function settleFailedAttempt(
  env: Env,
  batch: BatchRow,
  config: Config,
  task: TaskRow,
  e: unknown,
): Promise<void> {
  const refund =
    estimateCost({ ...config, model: config.model || (await resolveEngineModel(env)) }, 1, [
      task.card,
    ]).total + (task.edit || task.recenter ? 0.008 : 0);
  await run(env.DB, "UPDATE tasks SET cost = MAX(0, cost - ?) WHERE id = ?", refund, task.id);
  const message = errorMessage(e, "Generation failed.");
  if (isTransientEngineError(e) && task.attempts < MAX_AUTO_ATTEMPTS)
    await requeue(env, task, message);
  else await failTask(env, task, message, task.output);
  if (isFatalEngineError(e)) await pauseBatch(env, batch.id, message);
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
  const changed = await run(
    env.DB,
    "UPDATE batches SET state = 'paused', last_error = ?, updated = ? WHERE id = ? AND state != 'paused'",
    reason ? reason.slice(0, 500) : null,
    now(),
    batchId,
  );
  if (changed && reason) {
    const row = await first<{ name: string }>(
      env.DB,
      "SELECT name FROM batches WHERE id = ?",
      batchId,
    );
    await notify(env, `Batch paused: ${row?.name ?? batchId}`, reason);
  }
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
  if (SKILL_MODES.has(config.mode)) return setAwareQueue(env, batch, queued, limit);
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
  { background, deferSync }: DriveOptions,
): Promise<void> {
  const openai = isOpenAIModel(config.model);
  const google = isGoogleModel(config.model);
  const fal = isFalModel(config.model);
  const sync = openai || (google && !config.economy);
  if (sync && deferSync) return;
  if (fal) {
    if (!(await resolveFalKey(env)).key) {
      await pauseBatch(
        env,
        batch.id,
        "fal.ai is not connected. Add the API key in Connection and resume.",
      );
      return;
    }
  } else if (openai) {
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
  const client = openai || google || fal ? null : await makeClient(env, undefined, config.model);

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
    const attemptCost =
      estimateCost({ ...config, model: config.model || (await resolveEngineModel(env)) }, 1, [
        task.card,
      ]).total + (task.edit || task.recenter ? 0.008 : 0);
    await run(env.DB, "UPDATE tasks SET cost = cost + ? WHERE id = ?", attemptCost, task.id);
    try {
      const requestId = client
        ? await submitTask(env, client, batch, config, task)
        : fal
          ? await submitFalTask(env, batch, config, task)
          : google && config.economy
            ? await submitGoogleBackgroundTask(env, batch, config, task)
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
      await settleFailedAttempt(
        env,
        batch,
        config,
        { ...task, status: "processing", attempts: task.attempts + 1 },
        e,
      );
      if (isFatalEngineError(e)) return;
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
  // Scenes from the owner's other recent batches, so every new batch does not open on the same street.
  const recentRows = await all<{ brief: string }>(
    env.DB,
    "SELECT t.brief FROM tasks t JOIN batches b ON b.id = t.batch WHERE b.owner = ? AND t.batch != ? AND t.brief IS NOT NULL ORDER BY t.updated DESC LIMIT 12",
    batch.owner,
    batch.id,
  );
  const recentBriefs = recentRows.map((r) => JSON.parse(r.brief) as EditorialBrief);
  const recent = recentBriefs.map((b) => b.scene).filter(Boolean);
  const skillId = config.mode === "7" ? "zaid" : config.skill || "editorial";
  const library = await all<{ id: string }>(
    env.DB,
    "SELECT id FROM refs WHERE skill = ? ORDER BY created",
    skillId,
  );
  const usedReferences = [
    ...siblings.map((t) => (JSON.parse(t.brief!) as EditorialBrief).mood),
    ...recentBriefs.map((b) => b.mood),
  ].filter((x): x is string => !!x);
  const req: EditorialRequest = {
    image,
    run: task.card,
    recent,
    skill: skillId,
    skillDef: skillId === "zaid" ? undefined : await resolveSkill(env, skillId),
    references: library.map((r) => r.id),
    usedReferences,
    direction: config.mode === "7" ? config.prompt : undefined,
    market: config.market || "auto",
    preference: config.mode === "7" ? "" : config.prompt,
    aspectRatio: config.ratio,
    used,
    newModel: config.mode === "8",
  };
  // A saved look leads instead of the reference photos: same scene, pose and light, no mood photo.
  const look = config.look
    ? await first<{
        name: string;
        prompt: string;
        negative: string;
        scene: string;
        pose: string;
        light: string;
      }>(
        env.DB,
        "SELECT name, prompt, negative, scene, pose, light FROM looks WHERE id = ?",
        config.look,
      )
    : null;
  if (look) req.look = look;
  // Draw the scene here so the mood photo attached to the builder is the one the text names.
  const leader = await setLeader(env, batch, task, source);
  const leaderBrief = leader ? (JSON.parse(leader.brief) as EditorialBrief) : null;
  const plan = leaderBrief
    ? { scene: leaderBrief.scene || null, mood: leaderBrief.mood }
    : look
      ? { scene: look.scene || null }
      : planRun(req);
  req.scene = plan.scene;
  if (plan.mood) {
    req.reference = plan.mood;
    req.extraImages = [await referenceBytes(env, plan.mood)];
  }
  if (leader && leaderBrief) {
    req.set = {
      scene: leaderBrief.scene,
      light: leaderBrief.light,
      pose: leaderBrief.pose,
      hasImage: true,
    };
    req.extraImages = [...(req.extraImages ?? []), await outputBytes(env, leader)];
  }
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
  let brief: EditorialBrief;
  if (preferOpenAI) brief = await buildBriefWithOpenAI(openai!, req);
  else {
    try {
      brief = await buildBriefWithGoogle(google!, req);
    } catch (e) {
      // Gemini refuses some Cloudflare regions, and a drained prepaid balance; OpenAI can take over.
      if (openai && googleUnavailable(e)) brief = await buildBriefWithOpenAI(openai, req);
      else throw e;
    }
  }
  if (plan.mood) brief.mood = plan.mood;
  if (leader) brief.setOf = leader.id;
  await run(env.DB, "UPDATE tasks SET brief = ? WHERE id = ?", JSON.stringify(brief), task.id);
  return brief;
}

/** Google failures another vendor can cover: region refusal or an exhausted prepaid balance. */
function googleUnavailable(e: unknown): boolean {
  return /location is not supported|credits are used up|credits are depleted/i.test(
    errorMessage(e),
  );
}

/** A reference-library photo from R2. */
async function referenceBytes(env: Env, id: string): Promise<ImageBytes> {
  const row = await first<{ key: string }>(env.DB, "SELECT key FROM refs WHERE id = ?", id);
  const obj = row ? await env.BUCKET.get(row.key) : null;
  if (!obj) throw new StudioError("Reference photo is missing from the library.", 500);
  return { bytes: await obj.arrayBuffer(), mime: obj.httpMetadata?.contentType || "image/jpeg" };
}

/** Reference photo as a Higgsfield upload URL, cached in settings. */
async function referenceEngineUrl(env: Env, client: HiggsfieldClient, id: string): Promise<string> {
  const settingName = `ref_url_${id}`;
  const cached = await getSetting(env, settingName);
  if (cached) return cached;
  const img = await referenceBytes(env, id);
  const url = await client.upload(img.bytes, img.mime);
  await setSetting(env, settingName, url);
  return url;
}

const SKILL_MODES = new Set(["5", "7", "8"]);

/** Prompt for a card: the editorial brief in mode 5, the deterministic builder otherwise. */
async function promptFor(
  env: Env,
  batch: BatchRow,
  config: Config,
  task: TaskRow,
  source: SourceRow,
  edit: string,
  roles: PromptImages,
): Promise<string> {
  let prompt: string;
  if (SKILL_MODES.has(config.mode)) {
    const brief = await ensureBrief(env, batch, config, task, source);
    prompt = buildEditorialPrompt(
      brief.prompt,
      brief.negative,
      edit,
      roles,
      config.mode === "8",
      centeringApplies(config, task.card),
    );
  } else {
    prompt = buildPrompt(config, task.card, edit, roles);
  }
  if (task.recenter) prompt += `\n\n${RECENTER_SUFFIX}`;
  prompt = sanitizePrompt(prompt);
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
  const roles = {
    identity: false,
    firstCard: false,
    studio: false,
    revision: false,
    mood: false,
    set: false,
  };

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
  if (SKILL_MODES.has(config.mode)) {
    const brief = await ensureBrief(env, batch, config, task, source);
    if (brief.mood) {
      imageUrls.push(await referenceEngineUrl(env, client, brief.mood));
      roles.mood = true;
    }
    const sibling = brief.setOf ? await setSibling(env, brief.setOf) : null;
    if (sibling) {
      imageUrls.push(await outputEngineUrl(env, client, sibling));
      roles.set = true;
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
  const roles = {
    identity: false,
    firstCard: false,
    studio: false,
    revision: false,
    mood: false,
    set: false,
  };

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
  if (SKILL_MODES.has(config.mode)) {
    const brief = await ensureBrief(env, batch, config, task, source);
    if (brief.mood) {
      images.push(await referenceBytes(env, brief.mood));
      roles.mood = true;
    }
    const sibling = brief.setOf ? await setSibling(env, brief.setOf) : null;
    if (sibling) {
      images.push(await outputBytes(env, sibling));
      roles.set = true;
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
      await settleFailedAttempt(
        env,
        batch,
        config,
        { ...task, status: "processing", request_id: requestId, attempts: task.attempts + 1 },
        e,
      );
    }
  })();
  if (background) background(job);
  else await job;
  return requestId;
}

/** Economy mode: Google's Flex tier runs in the background and the finaliser polls for the image. */
async function submitGoogleBackgroundTask(
  env: Env,
  batch: BatchRow,
  config: Config,
  task: TaskRow,
): Promise<string> {
  const { images, roles, source } = await collectReferenceBytes(env, batch, config, task);
  const edit = task.edit?.trim() ?? "";
  const prompt = await promptFor(env, batch, config, task, source, edit, roles);
  const client = await makeGoogleClient(env);
  const id = await client.submitFlex({
    model: config.model!,
    prompt,
    images,
    aspectRatio: config.ratio,
    size: config.size,
  });
  return `google:${id}`;
}

const FLEX_TIMEOUT_MS = 26 * 60 * 60 * 1000; // Google's Flex tier may take up to a day

async function finalizeGoogleFlex(
  env: Env,
  batch: BatchRow,
  config: Config,
  task: TaskRow,
): Promise<void> {
  const age = now() - (task.leased_at ?? now());
  let client: GoogleImageClient;
  try {
    client = await makeGoogleClient(env);
  } catch {
    return;
  }
  let status: Awaited<ReturnType<GoogleImageClient["status"]>>;
  try {
    status = await client.status(task.request_id!.slice("google:".length));
  } catch (e) {
    if (isFatalEngineError(e)) await pauseBatch(env, batch.id, errorMessage(e));
    return;
  }
  if (status.state === "pending") {
    if (age > (config.economy ? FLEX_TIMEOUT_MS : GOOGLE_TIMEOUT_MS))
      await failTask(
        env,
        task,
        config.economy
          ? "Google Flex did not finish within a day. Retry this image."
          : "Google did not finish in time. Retry this image.",
        task.output,
      );
    return;
  }
  if (status.state === "failed") {
    if (status.retryable && task.attempts < MAX_AUTO_ATTEMPTS)
      await requeue(env, task, status.message);
    else await failTask(env, task, status.message, task.output);
    return;
  }
  const claimed = await run(
    env.DB,
    "UPDATE tasks SET status = 'finalizing', updated = ? WHERE id = ? AND status = 'processing' AND request_id = ?",
    now(),
    task.id,
    task.request_id,
  );
  if (!claimed) return;
  try {
    await storeResultBytes(env, batch, config, task, status.image, null);
    void client.forget(task.request_id!.slice("google:".length));
  } catch (e) {
    await run(
      env.DB,
      "UPDATE tasks SET status = 'processing', error = ?, updated = ? WHERE id = ? AND status = 'finalizing'",
      errorMessage(e, "Could not store the result."),
      now(),
      task.id,
    );
  }
}

const FAL_TIMEOUT_MS = 20 * 60 * 1000;

/** fal.ai queues the job; the finaliser polls for the image. */
async function submitFalTask(
  env: Env,
  batch: BatchRow,
  config: Config,
  task: TaskRow,
): Promise<string> {
  const { images, roles, source } = await collectReferenceBytes(env, batch, config, task);
  const edit = task.edit?.trim() ?? "";
  const prompt = await promptFor(env, batch, config, task, source, edit, roles);
  const client = await makeFalClient(env);
  const handle = await client.submit({
    model: config.model!,
    prompt,
    images,
    aspectRatio: config.ratio,
    size: config.size,
  });
  return encodeFalHandle(handle);
}

async function finalizeFal(
  env: Env,
  batch: BatchRow,
  config: Config,
  task: TaskRow,
): Promise<void> {
  const age = now() - (task.leased_at ?? now());
  let client: FalClient;
  try {
    client = await makeFalClient(env);
  } catch {
    return;
  }
  let status: Awaited<ReturnType<FalClient["status"]>>;
  try {
    status = await client.status(decodeFalHandle(task.request_id!));
  } catch (e) {
    if (isFatalEngineError(e)) await pauseBatch(env, batch.id, errorMessage(e));
    return;
  }
  if (status.state === "pending") {
    if (age > FAL_TIMEOUT_MS)
      await failTask(env, task, "fal.ai did not finish in time. Retry this image.", task.output);
    return;
  }
  if (status.state === "failed") {
    if (status.retryable && task.attempts < MAX_AUTO_ATTEMPTS)
      await requeue(env, task, status.message);
    else await failTask(env, task, status.message, task.output);
    return;
  }
  const claimed = await run(
    env.DB,
    "UPDATE tasks SET status = 'finalizing', updated = ? WHERE id = ? AND status = 'processing' AND request_id = ?",
    now(),
    task.id,
    task.request_id,
  );
  if (!claimed) return;
  try {
    await storeResultBytes(env, batch, config, task, status.image, null);
  } catch (e) {
    await run(
      env.DB,
      "UPDATE tasks SET status = 'processing', error = ?, updated = ? WHERE id = ? AND status = 'finalizing'",
      errorMessage(e, "Could not store the result."),
      now(),
      task.id,
    );
  }
}

/**
 * Product sets: images named <id>_01, <id>_02 ... are one product. The first file of a set (by name)
 * generates alone; the others wait for it and then copy its scene, light and reference so the set
 * looks like one shoot. Different sets run in parallel as usual.
 */
async function setAwareQueue(
  env: Env,
  batch: BatchRow,
  queued: (TaskRow & { source_name: string })[],
  limit: number,
): Promise<TaskRow[]> {
  const rows = await all<{
    id: string;
    status: string;
    output: string | null;
    card: number;
    name: string;
  }>(
    env.DB,
    "SELECT t.id, t.status, t.output, t.card, s.name FROM tasks t JOIN sources s ON s.id = t.source WHERE t.batch = ? ORDER BY s.name, t.card",
    batch.id,
  );
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = `${productKey(r.name)}#${r.card}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const out: TaskRow[] = [];
  const claimedGroups = new Set<string>();
  for (const t of queued) {
    const k = `${productKey(t.source_name)}#${t.card}`;
    const g = groups.get(k) ?? [];
    if (g.length > 1) {
      const leaderDone = g.some(
        (r) => !!r.output && !["processing", "finalizing", "queued"].includes(r.status),
      );
      const inFlight = g.some((r) => ["processing", "finalizing"].includes(r.status));
      const isFirst = g[0]?.id === t.id;
      // One at a time per set until the leader exists; then the rest may run in parallel.
      if (!leaderDone && (inFlight || claimedGroups.has(k) || !isFirst)) continue;
      if (!leaderDone) claimedGroups.add(k);
    }
    out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}

/** The sibling task of a set, if its output still exists. */
async function setSibling(env: Env, id: string): Promise<TaskRow | null> {
  const t = await first<TaskRow>(env.DB, "SELECT * FROM tasks WHERE id = ?", id);
  return t?.output ? t : null;
}

/** The already generated image of the same product (same card) whose scene this task must match. */
async function setLeader(
  env: Env,
  batch: BatchRow,
  task: TaskRow,
  source: SourceRow,
): Promise<(TaskRow & { brief: string }) | null> {
  const key = productKey(source.name);
  const rows = await all<TaskRow & { name: string }>(
    env.DB,
    "SELECT t.*, s.name FROM tasks t JOIN sources s ON s.id = t.source WHERE t.batch = ? AND t.card = ? AND t.id != ? AND t.output IS NOT NULL AND t.brief IS NOT NULL ORDER BY s.name",
    batch.id,
    task.card,
    task.id,
  );
  const leader = rows.find((r) => productKey(r.name) === key);
  return leader ? (leader as TaskRow & { brief: string }) : null;
}

/** Reference images as bytes (garment, card 1, card 2, latest result) for the synchronous engines. */
async function collectReferenceBytes(
  env: Env,
  batch: BatchRow,
  config: Config,
  task: TaskRow,
): Promise<{
  images: ImageBytes[];
  roles: PromptImages;
  source: SourceRow;
}> {
  const source = await first<SourceRow>(env.DB, "SELECT * FROM sources WHERE id = ?", task.source);
  if (!source) throw new StudioError("Original unavailable.", 404);
  const images: ImageBytes[] = [await sourceBytes(env, source)];
  const roles = {
    identity: false,
    firstCard: false,
    studio: false,
    revision: false,
    mood: false,
    set: false,
  };
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
  if (SKILL_MODES.has(config.mode)) {
    const brief = await ensureBrief(env, batch, config, task, source);
    if (brief.mood) {
      images.push(await referenceBytes(env, brief.mood));
      roles.mood = true;
    }
    const sibling = brief.setOf ? await setSibling(env, brief.setOf) : null;
    if (sibling) {
      images.push(await outputBytes(env, sibling));
      roles.set = true;
    }
  }
  const edit = task.edit?.trim() ?? "";
  if ((edit || task.recenter) && task.output) {
    images.push(await outputBytes(env, task));
    roles.revision = true;
  }
  return { images, roles, source };
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
  const changed = await run(
    env.DB,
    "UPDATE batches SET state = 'idle', updated = ? WHERE id = ? AND state = 'running'",
    now(),
    batch.id,
  );
  if (changed) {
    const row = await first<{
      name: string;
      total: number;
      review: number;
      failed: number;
      spent: number;
    }>(
      env.DB,
      "SELECT b.name, COUNT(t.id) AS total, SUM(CASE WHEN t.status='review' THEN 1 ELSE 0 END) AS review, SUM(CASE WHEN t.status='failed' THEN 1 ELSE 0 END) AS failed, SUM(t.cost) AS spent FROM batches b LEFT JOIN tasks t ON t.batch = b.id WHERE b.id = ? GROUP BY b.id",
      batch.id,
    );
    if (row)
      await notify(
        env,
        `Batch finished: ${row.name}`,
        `${row.total} images generated. ${row.review} need review, ${row.failed} failed. Estimated spend $${(row.spent ?? 0).toFixed(2)}.`,
      );
  }
}

/** Batches the cron trigger should look at. */
export async function activeBatchIds(env: Env): Promise<string[]> {
  const rows = await all<{ id: string }>(
    env.DB,
    "SELECT DISTINCT b.id FROM batches b LEFT JOIN tasks t ON t.batch = b.id AND t.status IN ('processing','finalizing') WHERE b.state = 'running' OR t.id IS NOT NULL LIMIT 50",
  );
  return rows.map((r) => r.id);
}
