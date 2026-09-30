import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "./env";
import { StudioError, errorMessage } from "./errors";
import { all, first, run, now, uuid } from "./db";
import { advanceBatch, engineConfigured, makeClient } from "./engine";
import {
  configSchema,
  validateConfig,
  createsTasks,
  CARDS_PER_SOURCE,
  type Config,
} from "@shared/config";
import { buildPrompt } from "@shared/prompts";
import { stemOf, stemKey, isValidSourceName } from "@shared/naming";
import type { User, Batch, Source, Task } from "@shared/types";

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
      "SELECT t.id, t.source, t.card, t.status, t.output, t.qa, t.error, t.prompt, t.attempts, t.request_id, t.updated FROM tasks t JOIN sources s ON s.id = t.source WHERE t.batch = ? ORDER BY s.name, t.card",
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
  const batches = await all<Batch>(
    c.env.DB,
    "SELECT id, name, config, state, last_error, created, updated FROM batches WHERE owner = ? ORDER BY created DESC LIMIT 200",
    user.id,
  );
  return c.json({
    user,
    batches,
    engine: {
      model: c.env.HIGGSFIELD_MODEL || "nano-banana-pro",
      configured: engineConfigured(c.env),
      review: !!c.env.GEMINI_API_KEY,
    },
  });
});

studioRoutes.get("/engine/verify", async (c) => {
  if (!engineConfigured(c.env))
    return c.json({ ok: false, message: "HIGGSFIELD_API_KEY is not set." });
  try {
    return c.json(await makeClient(c.env).verify());
  } catch (e) {
    return c.json({ ok: false, message: errorMessage(e) });
  }
});

const newBatch = z.object({ name: z.string().max(100).optional(), config: configSchema });

studioRoutes.post("/batch", async (c) => {
  const user = c.get("user");
  const parsed = newBatch.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw new StudioError("Invalid batch settings.");
  const config = parsed.data.config;
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
  const name = f.name.normalize("NFC");
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
      for (let card = 1; card <= CARDS_PER_SOURCE[config.mode]; card++) {
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
  if (!engineConfigured(c.env))
    throw new StudioError("Higgsfield is not connected. Set HIGGSFIELD_API_KEY as a secret.", 428);
  await run(
    c.env.DB,
    "UPDATE batches SET state = 'running', last_error = NULL, updated = ? WHERE id = ?",
    now(),
    b.id,
  );
  await advanceBatch(c.env, b.id);
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
  await advanceBatch(c.env, b.id);
  return c.json(await batchPayload(c.env, await ownedBatch(c.env, c.get("user"), b.id)));
});

studioRoutes.post("/retry", async (c) => {
  const { batch } = await body(c, batchRef);
  const b = await ownedBatch(c.env, c.get("user"), batch);
  await run(
    c.env.DB,
    "UPDATE tasks SET status = 'queued', error = NULL, updated = ? WHERE batch = ? AND status = 'failed'",
    now(),
    b.id,
  );
  await run(
    c.env.DB,
    "UPDATE batches SET state = 'running', last_error = NULL, updated = ? WHERE id = ?",
    now(),
    b.id,
  );
  await advanceBatch(c.env, b.id);
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
  await advanceBatch(c.env, b.id);
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

studioRoutes.post("/task/retry", async (c) => {
  const { batch, id } = await body(c, taskRef);
  const b = await ownedBatch(c.env, c.get("user"), batch);
  const changed = await run(
    c.env.DB,
    "UPDATE tasks SET status = 'queued', error = NULL, updated = ? WHERE id = ? AND batch = ? AND status = 'failed'",
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
  await advanceBatch(c.env, b.id);
  return c.json(await batchPayload(c.env, await ownedBatch(c.env, c.get("user"), b.id)));
});
