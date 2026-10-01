import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "./env";
import { StudioError, errorMessage } from "./errors";
import { all, first, run, now, uuid } from "./db";
import {
  advanceBatch,
  engineConfigured,
  keyLooksValid,
  makeClient,
  makeFalClient,
  makeGoogleClient,
  makeOpenAIClient,
} from "./engine";
import { OPENAI_MODELS } from "./openai";
import { GOOGLE_MODELS } from "./google";
import { FAL_MODELS } from "./fal";
import { listSkills } from "./skills";
import { buildSkillFromReferences } from "./skillbuilder";
import { SKILLS } from "@shared/skills";
import {
  ENGINE_KEY_SETTING,
  ENGINE_MODEL_SETTING,
  FAL_KEY_SETTING,
  GOOGLE_KEY_SETTING,
  OPENAI_KEY_SETTING,
  ZAID_DIRECTION_SETTING,
  deleteSetting,
  getSetting,
  resolveEngineKey,
  resolveEngineModel,
  resolveFalKey,
  resolveGoogleKey,
  resolveOpenAIKey,
  setSetting,
} from "./settings";
import {
  configSchema,
  validateConfig,
  createsTasks,
  cardsPerSource,
  type Config,
} from "@shared/config";
import { buildPrompt } from "@shared/prompts";
import { stemOf, stemKey, isValidSourceName, relativeUploadName } from "@shared/naming";
import type { User, Batch, Source, Task, Preset } from "@shared/types";
import { readAdminSettings } from "./admin";

type Variables = { user: User };
export const studioRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_UPLOAD = 12 * 1024 * 1024;
const MAX_IDENTITY = 8 * 1024 * 1024;
const MAX_REFERENCE = 3 * 1024 * 1024;

interface BatchRow extends Batch {
  owner: string;
  last_error: string | null;
}

async function ownedBatch(env: Env, user: User, id: string | undefined): Promise<BatchRow> {
  if (!id) throw new StudioError("Batch id is required.");
  const b = await first<BatchRow>(
    env.DB,
    "SELECT * FROM batches WHERE id = ? AND owner = ?",
    id,
    user.id,
  );
  if (!b) throw new StudioError("Batch not found.", 404);
  return b;
}

async function batchPayload(env: Env, b: BatchRow) {
  const [sources, tasks] = await Promise.all([
    all<Source>(
      env.DB,
      "SELECT id, name, mime, size, role, created FROM sources WHERE batch = ? ORDER BY name",
      b.id,
    ),
    all<Task>(
      env.DB,
      "SELECT t.id, t.source, t.card, t.status, t.output, t.qa, t.error, t.prompt, t.attempts, t.request_id, t.brief, t.cost, t.updated FROM tasks t JOIN sources s ON s.id = t.source WHERE t.batch = ? ORDER BY s.name, t.card",
      b.id,
    ),
  ]);
  // 'finalizing' is an internal step; the UI treats it as processing.
  for (const t of tasks) if (t.status === ("finalizing" as string)) t.status = "processing";
  const { owner: _owner, ...batch } = b;
  void _owner;
  return { batch, sources, tasks };
}

studioRoutes.get("/state", async (c) => {
  const user = c.get("user");
  const batches = await all<
    Batch & { total: number; completed: number; review: number; failed: number; queued: number }
  >(
    c.env.DB,
    `SELECT b.id, b.name, b.config, b.state, b.last_error, b.created, b.updated,
       COUNT(t.id) AS total,
       COALESCE(SUM(t.cost), 0) AS spent,
       SUM(CASE WHEN t.output IS NOT NULL THEN 1 ELSE 0 END) AS completed,
       SUM(CASE WHEN t.status = 'review' THEN 1 ELSE 0 END) AS review,
       SUM(CASE WHEN t.status = 'failed' THEN 1 ELSE 0 END) AS failed,
       SUM(CASE WHEN t.status IN ('queued','processing','finalizing') THEN 1 ELSE 0 END) AS queued
     FROM batches b LEFT JOIN tasks t ON t.batch = b.id
     WHERE b.owner = ? GROUP BY b.id ORDER BY b.created DESC LIMIT 200`,
    user.id,
  );
  const engineKey = await resolveEngineKey(c.env);
  const adminSettings = await readAdminSettings(c.env);
  return c.json({
    user,
    batches,
    spendThreshold: adminSettings.spendThreshold,
    zaidDirection: (await getSetting(c.env, ZAID_DIRECTION_SETTING)) || "",
    engine: {
      model: await resolveEngineModel(c.env),
      configured: keyLooksValid(engineKey.key),
      source: engineKey.source,
      openai: (await resolveOpenAIKey(c.env)).source,
      google: (await resolveGoogleKey(c.env)).source,
      fal: (await resolveFalKey(c.env)).source,
      review: !!(await resolveGoogleKey(c.env)).key,
    },
  });
});

/** Save an OpenAI key from the app after checking it against the Models endpoint. */
studioRoutes.post("/engine/openai-key", async (c) => {
  if (c.env.OPENAI_API_KEY)
    throw new StudioError("The OpenAI key is managed as a Worker secret on this deployment.", 409);
  const { key } = await body(c, z.object({ key: z.string().trim().min(10).max(400) }));
  const check = await (await makeOpenAIClient(c.env, key)).verify();
  if (!check.ok) throw new StudioError(`OpenAI rejected this key: ${check.message}`, 400);
  await setSetting(c.env, OPENAI_KEY_SETTING, key);
  await deleteSetting(c.env, MODELS_CACHE);
  return c.json({ ok: true, message: check.message });
});

/** Save a Google AI Studio key from the app. It also powers the automatic review. */
studioRoutes.post("/engine/google-key", async (c) => {
  if (c.env.GEMINI_API_KEY)
    throw new StudioError("The Google key is managed as a Worker secret on this deployment.", 409);
  const { key } = await body(c, z.object({ key: z.string().trim().min(20).max(400) }));
  const check = await (await makeGoogleClient(c.env, key)).verify();
  if (!check.ok) throw new StudioError(`Google rejected this key: ${check.message}`, 400);
  await setSetting(c.env, GOOGLE_KEY_SETTING, key);
  await deleteSetting(c.env, MODELS_CACHE);
  return c.json({ ok: true, message: check.message });
});

studioRoutes.delete("/engine/google-key", async (c) => {
  await deleteSetting(c.env, GOOGLE_KEY_SETTING);
  await deleteSetting(c.env, MODELS_CACHE);
  return c.json({ ok: true });
});

studioRoutes.post("/engine/fal-key", async (c) => {
  if (c.env.FAL_KEY)
    throw new StudioError("The fal.ai key is managed as a Worker secret on this deployment.", 409);
  const { key } = await body(c, z.object({ key: z.string().trim().min(20).max(400) }));
  const check = await (await makeFalClient(c.env, key)).verify();
  if (!check.ok) throw new StudioError(`fal.ai rejected this key: ${check.message}`, 400);
  await setSetting(c.env, FAL_KEY_SETTING, key);
  await deleteSetting(c.env, MODELS_CACHE);
  return c.json({ ok: true, message: check.message });
});

studioRoutes.delete("/engine/fal-key", async (c) => {
  await deleteSetting(c.env, FAL_KEY_SETTING);
  await deleteSetting(c.env, MODELS_CACHE);
  return c.json({ ok: true });
});

studioRoutes.delete("/engine/openai-key", async (c) => {
  await deleteSetting(c.env, OPENAI_KEY_SETTING);
  await deleteSetting(c.env, MODELS_CACHE);
  return c.json({ ok: true });
});

/** Known image models on the Higgsfield API. Each is probed (no generation) and cached for an hour. */
const MODEL_CANDIDATES: { slug: string; name: string }[] = [
  { slug: "nano-banana-pro", name: "Nano Banana Pro (via Higgsfield)" },
  { slug: "flux-2-pro", name: "FLUX.2 Pro (Higgsfield)" },
  { slug: "flux-2-max", name: "FLUX.2 Max (Higgsfield)" },
  { slug: "flux-2-flex", name: "FLUX.2 Flex (Higgsfield)" },
  { slug: "qwen-image-edit", name: "Qwen Image Edit (Higgsfield)" },
  { slug: "seedream-4-5", name: "Seedream 4.5 (Higgsfield)" },
  { slug: "gpt-image-2", name: "GPT Image 2 (via Higgsfield)" },
];
const MODELS_CACHE = "engine_models_cache";

/** Shared default text for the Zaid creative direction workflow (mode 7). */
studioRoutes.post("/direction", async (c) => {
  const { text } = await body(c, z.object({ text: z.string().max(20000) }));
  await setSetting(c.env, ZAID_DIRECTION_SETTING, text.trim());
  return c.json({ ok: true, text: text.trim() });
});

/** Team-managed skills: list, create or edit, delete (a built-in is hidden rather than removed). */
studioRoutes.get("/skills", async (c) => c.json({ skills: await listSkills(c.env) }));

const skillBody = z.object({
  id: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{2,40}$/, "Use lowercase letters, digits and dashes for the id.")
    .optional(),
  title: z.string().trim().min(2).max(60),
  caption: z.string().trim().max(80).default(""),
  description: z.string().trim().max(400).default(""),
  goal: z.string().trim().max(20000).default(""),
  library: z.string().trim().max(20000).default(""),
});

studioRoutes.post("/skills", async (c) => {
  const d = await body(c, skillBody);
  if (d.id === "zaid") throw new StudioError("Zaid's direction is edited from its own workflow.");
  const goal =
    d.goal ||
    `Goal: write ONE prompt for "${d.title}". The reference photos in this skill's library are the creative source: build the scene, pose and light from the attached reference as a sibling of it. The garment stays exactly as supplied; the output keeps the upload's framing.`;
  const id =
    d.id ||
    d.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) ||
    uuid().slice(0, 8);
  await run(
    c.env.DB,
    `INSERT INTO skills (id, title, caption, description, goal, library, hidden, created, updated)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
     ON CONFLICT(id) DO UPDATE SET title = excluded.title, caption = excluded.caption, description = excluded.description,
       goal = excluded.goal, library = excluded.library, hidden = 0, updated = excluded.updated`,
    id,
    d.title,
    d.caption,
    d.description,
    goal,
    d.library,
    now(),
    now(),
  );
  return c.json({ ok: true, id, skills: await listSkills(c.env) });
});

/** Writes a skill's direction and library from its reference photos (returned for review, not saved). */
studioRoutes.post("/skills/:id/analyze", async (c) => {
  const id = c.req.param("id");
  const { title } = await body(c, z.object({ title: z.string().trim().min(2).max(60) }));
  const rows = await all<{ key: string }>(
    c.env.DB,
    "SELECT key FROM refs WHERE skill = ? ORDER BY created LIMIT 10",
    id,
  );
  const images = [];
  for (const r of rows) {
    const obj = await c.env.BUCKET.get(r.key);
    if (obj)
      images.push({
        bytes: await obj.arrayBuffer(),
        mime: obj.httpMetadata?.contentType || "image/jpeg",
      });
  }
  return c.json(await buildSkillFromReferences(c.env, title, images));
});

/** Built-in skills are hidden (and any edit of them dropped); custom ones are removed. Reference photos stay. */
studioRoutes.delete("/skills/:id", async (c) => {
  const id = c.req.param("id");
  if (id === "editorial") throw new StudioError("The Fashion editorial skill is the fallback and cannot be deleted.");
  if (SKILLS.some((s) => s.id === id)) {
    await run(
      c.env.DB,
      `INSERT INTO skills (id, title, caption, description, goal, library, hidden, created, updated)
       VALUES (?, ?, '', '', '', '', 1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET hidden = 1, updated = excluded.updated`,
      id,
      id,
      now(),
      now(),
    );
  } else {
    await run(c.env.DB, "DELETE FROM skills WHERE id = ?", id);
  }
  return c.json({ ok: true, skills: await listSkills(c.env) });
});

/** Restores a hidden built-in skill to its original text. */
studioRoutes.post("/skills/:id/reset", async (c) => {
  const id = c.req.param("id");
  if (!SKILLS.some((s) => s.id === id)) throw new StudioError("Only built-in skills can be reset.");
  await run(c.env.DB, "DELETE FROM skills WHERE id = ?", id);
  return c.json({ ok: true, skills: await listSkills(c.env) });
});

/** Reference library: inspiration photos per skill (background, pose and light only). */
const MAX_REFERENCE_UPLOAD = 12 * 1024 * 1024;
const skillRef = z.object({ skill: z.string().regex(/^[a-z0-9-]{1,40}$/) });

studioRoutes.get("/references", async (c) => {
  const { skill } = skillRef.parse({ skill: c.req.query("skill") ?? "" });
  const items = await all<{ id: string; name: string | null; created: number }>(
    c.env.DB,
    "SELECT id, name, created FROM refs WHERE skill = ? ORDER BY created",
    skill,
  );
  return c.json({ references: items });
});

studioRoutes.post("/references", async (c) => {
  const form = await c.req.formData();
  const { skill } = skillRef.parse({ skill: String(form.get("skill") ?? "") });
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (!files.length) throw new StudioError("Choose at least one image.");
  const added: string[] = [];
  for (const raw of files.slice(0, 20)) {
    const f = checkImage(raw, MAX_REFERENCE_UPLOAD, "Reference");
    const id = uuid();
    const key = `refs/${skill}/${id}`;
    await c.env.BUCKET.put(key, f.stream(), { httpMetadata: { contentType: f.type } });
    await run(
      c.env.DB,
      "INSERT INTO refs (id, skill, key, name, created) VALUES (?, ?, ?, ?, ?)",
      id,
      skill,
      key,
      f.name.slice(0, 120),
      now(),
    );
    added.push(id);
  }
  return c.json({ ok: true, added });
});

studioRoutes.delete("/references/:id", async (c) => {
  const id = c.req.param("id");
  const row = await first<{ key: string }>(c.env.DB, "SELECT key FROM refs WHERE id = ?", id);
  if (!row) throw new StudioError("Reference not found.", 404);
  await c.env.BUCKET.delete(row.key);
  await run(c.env.DB, "DELETE FROM refs WHERE id = ?", id);
  await deleteSetting(c.env, `ref_url_${id}`);
  return c.json({ ok: true });
});

studioRoutes.get("/references/:id/file", async (c) => {
  const id = c.req.param("id");
  const row = await first<{ key: string }>(c.env.DB, "SELECT key FROM refs WHERE id = ?", id);
  const obj = row ? await c.env.BUCKET.get(row.key) : null;
  if (!obj) throw new StudioError("Reference not found.", 404);
  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType || "image/jpeg",
      "Cache-Control": "private, max-age=86400",
    },
  });
});

/** Raw Higgsfield model catalogue for the connected key. */
studioRoutes.get("/engine/catalog", async (c) => {
  return c.json(await (await makeClient(c.env)).catalog());
});

studioRoutes.get("/engine/models", async (c) => {
  const refresh = c.req.query("refresh") === "1";
  if (!refresh) {
    const cached = await getSetting(c.env, MODELS_CACHE);
    if (cached) {
      const parsed = JSON.parse(cached) as { at: number; models: unknown[] };
      if (now() - parsed.at < 60 * 60 * 1000)
        return c.json({ models: parsed.models, cached: true });
    }
  }
  const models: { slug: string; name: string; enabled: boolean; reason: string }[] = [];
  const googleKey = (await resolveGoogleKey(c.env)).key;
  if (googleKey) {
    try {
      const g = await makeGoogleClient(c.env, googleKey);
      for (const m of GOOGLE_MODELS) {
        const ok = await g.hasModel(m.slug);
        models.push({ ...m, enabled: ok, reason: ok ? "" : "not available to this Google key" });
      }
    } catch (e) {
      for (const m of GOOGLE_MODELS) models.push({ ...m, enabled: false, reason: errorMessage(e) });
    }
  } else {
    for (const m of GOOGLE_MODELS)
      models.push({ ...m, enabled: false, reason: "add a Google key" });
  }
  const openaiKey = (await resolveOpenAIKey(c.env)).key;
  if (openaiKey) {
    try {
      const oa = await makeOpenAIClient(c.env, openaiKey);
      for (const m of OPENAI_MODELS) {
        const ok = await oa.hasModel(m.slug);
        models.push({
          ...m,
          enabled: ok,
          reason: ok ? "" : "not available on this OpenAI account",
        });
      }
    } catch (e) {
      for (const m of OPENAI_MODELS) models.push({ ...m, enabled: false, reason: errorMessage(e) });
    }
  } else {
    for (const m of OPENAI_MODELS)
      models.push({ ...m, enabled: false, reason: "add an OpenAI key" });
  }
  const falKey = (await resolveFalKey(c.env)).key;
  if (falKey) {
    let reason = "";
    try {
      const check = await (await makeFalClient(c.env, falKey)).verify();
      if (!check.ok) reason = check.message;
    } catch (e) {
      reason = errorMessage(e);
    }
    for (const m of FAL_MODELS) models.push({ ...m, enabled: !reason, reason });
  } else {
    for (const m of FAL_MODELS) models.push({ ...m, enabled: false, reason: "add a fal.ai key" });
  }
  if (await engineConfigured(c.env)) {
    const client = await makeClient(c.env);
    const probed = await Promise.all(
      MODEL_CANDIDATES.map(async (m) => {
        try {
          const r = await client.probeModel(m.slug);
          const code = r.detail.trim().toLowerCase();
          const enabled =
            r.status !== 404 && code !== "model_not_found" && code !== "model_disabled";
          return { ...m, enabled, reason: enabled ? "" : code || `HTTP ${r.status}` };
        } catch (e) {
          return { ...m, enabled: false, reason: errorMessage(e) };
        }
      }),
    );
    models.push(...probed);
  } else {
    for (const m of MODEL_CANDIDATES)
      models.push({ ...m, enabled: false, reason: "add a Higgsfield key" });
  }
  // Never cache a scan in which nothing answered (network trouble), so the next open re-probes.
  if (models.some((m) => m.enabled))
    await setSetting(c.env, MODELS_CACHE, JSON.stringify({ at: now(), models }));
  return c.json({ models });
});

studioRoutes.get("/engine/verify", async (c) => {
  if (!(await engineConfigured(c.env)))
    return c.json({ ok: false, message: "No Higgsfield API key is configured." });
  try {
    return c.json(await (await makeClient(c.env)).verify());
  } catch (e) {
    return c.json({ ok: false, message: errorMessage(e) });
  }
});

/** Save the engine key from the app. It is verified against Higgsfield first and stored encrypted. */
studioRoutes.post("/engine/key", async (c) => {
  if (c.env.HIGGSFIELD_API_KEY)
    throw new StudioError("The key is managed as a Worker secret on this deployment.", 409);
  const { key } = await body(c, z.object({ key: z.string().trim().min(3).max(500) }));
  if (!keyLooksValid(key))
    throw new StudioError(
      "Enter the key as KEY_ID:KEY_SECRET (both parts from cloud.higgsfield.ai).",
    );
  const check = await (await makeClient(c.env, key)).verify();
  if (!check.ok) throw new StudioError(`Higgsfield rejected this key: ${check.message}`, 400);
  await setSetting(c.env, ENGINE_KEY_SETTING, key);
  return c.json({ ok: true, message: check.message });
});

/** Diagnostic used to find the right model slug: reports the API's answer for a slug without generating. */
studioRoutes.get("/engine/probe", async (c) => {
  const slug = (c.req.query("slug") ?? "").trim();
  if (!slug || slug.length > 120 || !/^[\w./-]+$/.test(slug))
    throw new StudioError("Invalid slug.");
  const raw = c.req.query("body");
  let body = "{}";
  if (raw) {
    try {
      body = JSON.stringify(JSON.parse(raw));
    } catch {
      throw new StudioError("Probe body must be JSON.");
    }
  }
  return c.json(await (await makeClient(c.env)).probeModel(slug, body));
});

/** Save the model slug after checking that Higgsfield knows it and has it enabled. */
studioRoutes.post("/engine/model", async (c) => {
  const { model } = await body(c, z.object({ model: z.string().trim().min(1).max(120) }));
  if (!/^[\w./-]+$/.test(model)) throw new StudioError("Invalid model slug.");
  if (GOOGLE_MODELS.some((m) => m.slug === model)) {
    const g = await makeGoogleClient(c.env);
    if (!(await g.hasModel(model)))
      throw new StudioError(`"${model}" is not available to your Google key.`);
    await setSetting(c.env, ENGINE_MODEL_SETTING, model);
    return c.json({ ok: true, message: `Model "${model}" is available.` });
  }
  if (FAL_MODELS.some((m) => m.slug === model)) {
    const check = await (await makeFalClient(c.env)).verify();
    if (!check.ok) throw new StudioError(`fal.ai key problem: ${check.message}`);
    await setSetting(c.env, ENGINE_MODEL_SETTING, model);
    return c.json({ ok: true, message: `Model "${model}" is available.` });
  }
  if (OPENAI_MODELS.some((m) => m.slug === model)) {
    const oa = await makeOpenAIClient(c.env);
    if (!(await oa.hasModel(model)))
      throw new StudioError(`"${model}" is not available on your OpenAI account.`);
    await setSetting(c.env, ENGINE_MODEL_SETTING, model);
    return c.json({ ok: true, message: `Model "${model}" is available.` });
  }
  const probe = await (await makeClient(c.env)).probeModel(model);
  const code = probe.detail.trim().toLowerCase();
  if (probe.status === 404 || code === "model_not_found")
    throw new StudioError(`Higgsfield does not know a model called "${model}".`);
  if (code === "model_disabled")
    throw new StudioError(`"${model}" exists but is disabled on your Higgsfield account.`);
  await setSetting(c.env, ENGINE_MODEL_SETTING, model);
  const note =
    code === "not_enough_credits" ? " Note: your Higgsfield account has no credits yet." : "";
  return c.json({ ok: true, message: `Model "${model}" is available.${note}` });
});

studioRoutes.delete("/engine/key", async (c) => {
  await deleteSetting(c.env, ENGINE_KEY_SETTING);
  return c.json({ ok: true });
});

const newBatch = z.object({ name: z.string().max(100).optional(), config: configSchema });

studioRoutes.post("/batch", async (c) => {
  const user = c.get("user");
  const parsed = newBatch.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.filter((p) => p !== "config").join(".") || "settings";
    throw new StudioError(`Invalid batch settings: ${field} ${issue?.message ?? "is invalid"}.`);
  }
  const config = parsed.data.config;
  if (!config.model) config.model = await resolveEngineModel(c.env);
  if (config.model && !/^[\w./-]+$/.test(config.model))
    throw new StudioError("Invalid model slug.");
  const problem = validateConfig(config);
  if (problem) throw new StudioError(problem);
  if (config.identity) {
    const identity = await first(
      c.env.DB,
      "SELECT id FROM identities WHERE id = ? AND owner = ?",
      config.identity,
      user.id,
    );
    if (!identity) throw new StudioError("Identity reference not found.");
  }
  const id = uuid();
  await run(
    c.env.DB,
    "INSERT INTO batches (id, owner, name, config, state, created, updated) VALUES (?, ?, ?, ?, 'idle', ?, ?)",
    id,
    user.id,
    (parsed.data.name || "New batch").slice(0, 100),
    JSON.stringify(config),
    now(),
    now(),
  );
  return c.json({ id });
});

/**
 * Edit a saved batch's creative direction. The workflow (mode) is fixed because it defines the card
 * structure; everything else can change. Queued tasks get fresh prompts, and the number of cards per
 * source is grown or shrunk (only never-generated cards are removed).
 */
studioRoutes.post("/batch/config", async (c) => {
  const user = c.get("user");
  const parsed = z
    .object({
      batch: z.string().min(1),
      name: z.string().max(100).optional(),
      config: configSchema,
    })
    .safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.filter((p) => p !== "config").join(".") || "settings";
    throw new StudioError(`Invalid batch settings: ${field} ${issue?.message ?? "is invalid"}.`);
  }
  const b = await ownedBatch(c.env, user, parsed.data.batch);
  if (b.state === "running")
    throw new StudioError("Pause the batch before editing its settings.", 409);
  const previous = JSON.parse(b.config) as Config;
  const config = { ...parsed.data.config, mode: previous.mode };
  if (!config.model) config.model = await resolveEngineModel(c.env);
  if (config.model && !/^[\w./-]+$/.test(config.model))
    throw new StudioError("Invalid model slug.");
  const problem = validateConfig(config);
  if (problem) throw new StudioError(problem);

  const statements = [
    c.env.DB.prepare("UPDATE batches SET config = ?, name = ?, updated = ? WHERE id = ?").bind(
      JSON.stringify(config),
      (parsed.data.name || b.name).slice(0, 100),
      now(),
      b.id,
    ),
  ];
  const wanted = cardsPerSource(config);
  const sources = await all<{ id: string; role: string }>(
    c.env.DB,
    "SELECT id, role FROM sources WHERE batch = ?",
    b.id,
  );
  for (const src of sources) {
    if (!createsTasks(config, src.role as "lead" | "supporting")) continue;
    const tasks = await all<{ id: string; card: number; status: string; output: string | null }>(
      c.env.DB,
      "SELECT id, card, status, output FROM tasks WHERE batch = ? AND source = ? ORDER BY card",
      b.id,
      src.id,
    );
    const have = new Set(tasks.map((t) => t.card));
    for (let card = 1; card <= wanted; card++) {
      if (!have.has(card))
        statements.push(
          c.env.DB.prepare(
            "INSERT INTO tasks (id, batch, source, card, status, prompt, updated) VALUES (?, ?, ?, ?, 'queued', ?, ?)",
          ).bind(uuid(), b.id, src.id, card, buildPrompt(config, card), now()),
        );
    }
    for (const t of tasks) {
      if (t.card > wanted && !t.output && t.status !== "processing")
        statements.push(c.env.DB.prepare("DELETE FROM tasks WHERE id = ?").bind(t.id));
      else if (t.status === "queued" || t.status === "failed")
        statements.push(
          c.env.DB.prepare("UPDATE tasks SET prompt = ?, brief = NULL WHERE id = ?").bind(
            buildPrompt(config, t.card),
            t.id,
          ),
        );
    }
  }
  await c.env.DB.batch(statements);
  return c.json(await batchPayload(c.env, await ownedBatch(c.env, user, b.id)));
});

studioRoutes.get("/batch", async (c) => {
  const b = await ownedBatch(c.env, c.get("user"), c.req.query("batch"));
  return c.json(await batchPayload(c.env, b));
});

studioRoutes.delete("/batch", async (c) => {
  const b = await ownedBatch(c.env, c.get("user"), c.req.query("batch"));
  const prefix = `${b.owner}/${b.id}/`;
  let cursor: string | undefined;
  do {
    const page = await c.env.BUCKET.list({ prefix, cursor, limit: 500 });
    if (page.objects.length) await c.env.BUCKET.delete(page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM tasks WHERE batch = ?").bind(b.id),
    c.env.DB.prepare("DELETE FROM sources WHERE batch = ?").bind(b.id),
    c.env.DB.prepare("DELETE FROM batches WHERE id = ? AND owner = ?").bind(b.id, b.owner),
  ]);
  return c.json({ ok: true });
});

function checkImage(f: unknown, max: number, label: string): File {
  if (!(f instanceof File)) throw new StudioError(`${label} is missing.`);
  if (!IMAGE_TYPES.includes(f.type)) throw new StudioError(`${label}: use JPG, PNG or WebP.`);
  if (f.size > max)
    throw new StudioError(`${label}: file is over ${Math.round(max / 1048576)} MB.`);
  return f;
}

studioRoutes.post("/identity", async (c) => {
  const user = c.get("user");
  const form = await c.req.formData();
  const f = checkImage(form.get("file"), MAX_IDENTITY, "Identity reference");
  const id = uuid();
  const key = `${user.id}/identity/${id}`;
  await c.env.BUCKET.put(key, f.stream(), { httpMetadata: { contentType: f.type } });
  await run(
    c.env.DB,
    "INSERT INTO identities (id, owner, key, name, created) VALUES (?, ?, ?, ?, ?)",
    id,
    user.id,
    key,
    String(form.get("name") || f.name).slice(0, 200),
    now(),
  );
  return c.json({ id });
});

studioRoutes.post("/upload", async (c) => {
  const user = c.get("user");
  const b = await ownedBatch(c.env, user, c.req.query("batch"));
  const config = JSON.parse(b.config) as Config;
  const form = await c.req.formData();
  const f = checkImage(form.get("file"), MAX_UPLOAD, "Image");
  const name = relativeUploadName(String(form.get("name") || ""), f.name).normalize("NFC");
  if (!isValidSourceName(name)) throw new StudioError("Unsupported filename.");
  const stem = stemKey(name);
  const duplicate = await first(
    c.env.DB,
    "SELECT id FROM sources WHERE batch = ? AND stem = ?",
    b.id,
    stem,
  );
  if (duplicate)
    throw new StudioError(
      `Duplicate output name: ${stemOf(name)}-AI.png already exists in this batch.`,
      409,
    );

  const role = form.get("role") === "supporting" ? "supporting" : "lead";
  const id = uuid();
  const key = `${user.id}/${b.id}/source/${id}`;
  await c.env.BUCKET.put(key, f.stream(), { httpMetadata: { contentType: f.type } });
  let referenceKey: string | null = null;
  const reference = form.get("reference");
  if (
    reference instanceof File &&
    reference.type === "image/jpeg" &&
    reference.size <= MAX_REFERENCE
  ) {
    referenceKey = `${key}.reference`;
    await c.env.BUCKET.put(referenceKey, reference.stream(), {
      httpMetadata: { contentType: "image/jpeg" },
    });
  }
  try {
    const statements = [
      c.env.DB.prepare(
        "INSERT INTO sources (id, batch, name, stem, key, reference_key, mime, size, role, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(id, b.id, name, stem, key, referenceKey, f.type, f.size, role, now()),
    ];
    if (createsTasks(config, role)) {
      for (let card = 1; card <= cardsPerSource(config); card++) {
        statements.push(
          c.env.DB.prepare(
            "INSERT INTO tasks (id, batch, source, card, status, prompt, updated) VALUES (?, ?, ?, ?, 'queued', ?, ?)",
          ).bind(uuid(), b.id, id, card, buildPrompt(config, card), now()),
        );
      }
    }
    await c.env.DB.batch(statements);
  } catch (e) {
    await c.env.BUCKET.delete([key, ...(referenceKey ? [referenceKey] : [])]);
    throw e;
  }
  await run(c.env.DB, "UPDATE batches SET updated = ? WHERE id = ?", now(), b.id);
  return c.json({ id });
});

studioRoutes.get("/file", async (c) => {
  const b = await ownedBatch(c.env, c.get("user"), c.req.query("batch"));
  const id = c.req.query("id") ?? "";
  const kind = c.req.query("kind") ?? "result";
  let key: string | null = null;
  let filename = "image";
  if (kind === "original" || kind === "reference") {
    const row = await first<{ key: string; reference_key: string | null; name: string }>(
      c.env.DB,
      "SELECT key, reference_key, name FROM sources WHERE id = ? AND batch = ?",
      id,
      b.id,
    );
    key = kind === "reference" ? (row?.reference_key ?? row?.key ?? null) : (row?.key ?? null);
    filename = row?.name ?? filename;
  } else {
    const row = await first<{ output: string | null }>(
      c.env.DB,
      "SELECT output FROM tasks WHERE id = ? AND batch = ?",
      id,
      b.id,
    );
    key = row?.output ?? null;
  }
  if (!key) throw new StudioError("Image not found.", 404);
  const obj = await c.env.BUCKET.get(key);
  if (!obj) throw new StudioError("Image not found.", 404);
  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType || "image/png",
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
});

const batchRef = z.object({ batch: z.string().min(1) });
const taskRef = batchRef.extend({ id: z.string().min(1) });

async function body<T extends z.ZodTypeAny>(
  c: { req: { json: () => Promise<unknown> } },
  schema: T,
): Promise<z.infer<T>> {
  const parsed = schema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw new StudioError("Invalid request.");
  return parsed.data;
}

studioRoutes.post("/start", async (c) => {
  const { batch } = await body(c, batchRef);
  const b = await ownedBatch(c.env, c.get("user"), batch);
  if (
    !(await engineConfigured(c.env)) &&
    !(await resolveGoogleKey(c.env)).key &&
    !(await resolveOpenAIKey(c.env)).key &&
    !(await resolveFalKey(c.env)).key
  )
    throw new StudioError("No image engine is connected. Add an API key in Connection.", 428);
  await run(
    c.env.DB,
    "UPDATE batches SET state = 'running', last_error = NULL, updated = ? WHERE id = ?",
    now(),
    b.id,
  );
  await advanceBatch(c.env, b.id, { background: (p) => c.executionCtx.waitUntil(p), deferSync: true });
  return c.json(await batchPayload(c.env, await ownedBatch(c.env, c.get("user"), b.id)));
});

studioRoutes.post("/pause", async (c) => {
  const { batch } = await body(c, batchRef);
  const b = await ownedBatch(c.env, c.get("user"), batch);
  await run(
    c.env.DB,
    "UPDATE batches SET state = 'paused', updated = ? WHERE id = ? AND state = 'running'",
    now(),
    b.id,
  );
  return c.json(await batchPayload(c.env, await ownedBatch(c.env, c.get("user"), b.id)));
});

studioRoutes.post("/tick", async (c) => {
  const { batch } = await body(c, batchRef);
  const b = await ownedBatch(c.env, c.get("user"), batch);
  // The tick keeps its connection open until the synchronous generations it started have been
  // saved, so they are never cut off by the post-response waitUntil limit.
  const jobs: Promise<unknown>[] = [];
  await advanceBatch(c.env, b.id, { background: (p) => jobs.push(p) });
  await Promise.allSettled(jobs);
  return c.json(await batchPayload(c.env, await ownedBatch(c.env, c.get("user"), b.id)));
});

studioRoutes.post("/retry", async (c) => {
  const { batch } = await body(c, batchRef);
  const b = await ownedBatch(c.env, c.get("user"), batch);
  await run(
    c.env.DB,
    // A failed image gets a freshly written prompt on retry (the cached brief may be what was refused).
    "UPDATE tasks SET status = 'queued', error = NULL, brief = NULL, updated = ? WHERE batch = ? AND status = 'failed'",
    now(),
    b.id,
  );
  await run(
    c.env.DB,
    "UPDATE batches SET state = 'running', last_error = NULL, updated = ? WHERE id = ?",
    now(),
    b.id,
  );
  await advanceBatch(c.env, b.id, { background: (p) => c.executionCtx.waitUntil(p), deferSync: true });
  return c.json(await batchPayload(c.env, await ownedBatch(c.env, c.get("user"), b.id)));
});

studioRoutes.post("/revise", async (c) => {
  const { batch, id, edit } = await body(
    c,
    taskRef.extend({ edit: z.string().trim().min(1).max(3000) }),
  );
  const b = await ownedBatch(c.env, c.get("user"), batch);
  const changed = await run(
    c.env.DB,
    "UPDATE tasks SET status = 'queued', edit = ?, error = NULL, updated = ? WHERE id = ? AND batch = ? AND output IS NOT NULL AND status IN ('ready','review','approved','failed')",
    edit,
    now(),
    id,
    b.id,
  );
  if (!changed) throw new StudioError("This image cannot be revised right now.", 409);
  await run(
    c.env.DB,
    "UPDATE batches SET state = 'running', last_error = NULL, updated = ? WHERE id = ?",
    now(),
    b.id,
  );
  await advanceBatch(c.env, b.id, { background: (p) => c.executionCtx.waitUntil(p), deferSync: true });
  return c.json(await batchPayload(c.env, await ownedBatch(c.env, c.get("user"), b.id)));
});

studioRoutes.post("/approve", async (c) => {
  const { batch, id } = await body(c, taskRef);
  const b = await ownedBatch(c.env, c.get("user"), batch);
  const changed = await run(
    c.env.DB,
    "UPDATE tasks SET status = 'approved', updated = ? WHERE id = ? AND batch = ? AND output IS NOT NULL AND status IN ('ready','review')",
    now(),
    id,
    b.id,
  );
  if (!changed) throw new StudioError("Image is not ready for approval.", 409);
  return c.json({ ok: true });
});

studioRoutes.post("/approve-all", async (c) => {
  const { batch } = await body(c, batchRef);
  const b = await ownedBatch(c.env, c.get("user"), batch);
  const changed = await run(
    c.env.DB,
    "UPDATE tasks SET status = 'approved', updated = ? WHERE batch = ? AND status = 'ready' AND output IS NOT NULL",
    now(),
    b.id,
  );
  return c.json({ ok: true, approved: changed });
});

studioRoutes.get("/presets", async (c) => {
  const presets = await all<Preset>(
    c.env.DB,
    "SELECT id, name, config, created FROM presets WHERE owner = ? ORDER BY created DESC LIMIT 100",
    c.get("user").id,
  );
  return c.json({ presets });
});

studioRoutes.post("/presets", async (c) => {
  const { name, config } = await body(
    c,
    z.object({ name: z.string().trim().min(1).max(80), config: configSchema }),
  );
  const id = uuid();
  await run(
    c.env.DB,
    "INSERT INTO presets (id, owner, name, config, created) VALUES (?, ?, ?, ?, ?)",
    id,
    c.get("user").id,
    name,
    JSON.stringify(config),
    now(),
  );
  return c.json({ id });
});

studioRoutes.delete("/presets", async (c) => {
  await run(
    c.env.DB,
    "DELETE FROM presets WHERE id = ? AND owner = ?",
    c.req.query("id") ?? "",
    c.get("user").id,
  );
  return c.json({ ok: true });
});

studioRoutes.post("/task/retry", async (c) => {
  const { batch, id } = await body(c, taskRef);
  const b = await ownedBatch(c.env, c.get("user"), batch);
  const changed = await run(
    c.env.DB,
    "UPDATE tasks SET status = 'queued', error = NULL, brief = NULL, updated = ? WHERE id = ? AND batch = ? AND status = 'failed'",
    now(),
    id,
    b.id,
  );
  if (!changed) throw new StudioError("Only failed images can be retried.", 409);
  await run(
    c.env.DB,
    "UPDATE batches SET state = 'running', last_error = NULL, updated = ? WHERE id = ?",
    now(),
    b.id,
  );
  await advanceBatch(c.env, b.id, { background: (p) => c.executionCtx.waitUntil(p), deferSync: true });
  return c.json(await batchPayload(c.env, await ownedBatch(c.env, c.get("user"), b.id)));
});
