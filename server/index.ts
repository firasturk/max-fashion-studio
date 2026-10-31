import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import type { Env } from "./env";
import { StudioError, errorMessage } from "./errors";
import { authRoutes, currentUser, SESSION_COOKIE } from "./auth";
import { studioRoutes } from "./studio";
import { verifyObjectToken } from "./signed";
import { adminRoutes, cleanupOldBatches } from "./admin";
import { advanceBatch, activeBatchIds, readPendingReferences, runLearning } from "./engine";
import { LEARN_LAST_RUN, learnDue } from "./memory";
import { logEvent, pruneEvents } from "./events";
import { DEV_HOOK_TOKEN_SETTING, claimNextDevJob, getDevJob, updateDevJob } from "./devjobs";
import { getSetting, setSetting } from "./settings";
import type { User } from "@shared/types";
import { serveStatic } from "./static";

type Variables = { user: User };

import { ASSETS } from "./generated/assets";

/** Changes with every deploy: the hashed script names are unique to a build. */
const BUILD_ID = Object.keys(ASSETS)
  .filter((k) => k.endsWith(".js"))
  .sort()
  .join("|")
  .split("")
  .reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7)
  .toString(36);

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Same-origin guard for state-changing requests. Browsers always send Origin on cross-origin POSTs.
app.use("/api/*", async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    const origin = c.req.header("origin");
    const site = c.req.header("sec-fetch-site");
    if ((origin && origin !== new URL(c.req.url).origin) || site === "cross-site") {
      throw new StudioError("Invalid request origin.", 403);
    }
  }
  await next();
  c.header("Cache-Control", c.res.headers.get("Cache-Control") ?? "no-store");
  // The build the page's scripts belong to: the client reloads when it changes under it.
  c.res.headers.set("X-Build", BUILD_ID);
});

app.route("/api/auth", authRoutes);

// Signed, short-lived access to one stored image, for engines that fetch inputs by URL (fal.ai).
app.get("/api/public/object", async (c) => {
  const key = c.req.query("k") ?? "";
  const exp = c.req.query("e") ?? "";
  const sig = c.req.query("s") ?? "";
  if (!key || !(await verifyObjectToken(c.env, key, exp, sig)))
    return c.json({ error: "Invalid or expired link." }, 403);
  const obj = await c.env.BUCKET.get(key);
  if (!obj) return c.json({ error: "Not found." }, 404);
  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType || "image/jpeg",
      "Content-Length": String(obj.size),
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

// Engine webhook: no session, protected by the shared token. Payload is ignored; state is re-read from the engine.
app.post("/api/hooks/engine", async (c) => {
  const token = c.req.query("token");
  const batch = c.req.query("batch");
  if (!c.env.WEBHOOK_TOKEN || !token || token !== c.env.WEBHOOK_TOKEN || !batch)
    return c.json({ ok: false }, 403);
  c.executionCtx.waitUntil(
    advanceBatch(c.env, batch, { background: (p) => c.executionCtx.waitUntil(p), deferSync: true }),
  );
  return c.json({ ok: true });
});

async function devHookOk(c: { env: Env }, token: unknown): Promise<boolean> {
  const expected = await getSetting(c.env, DEV_HOOK_TOKEN_SETTING);
  return !!expected && typeof token === "string" && token === expected;
}

/** The Actions run asking for work: the oldest queued job, now running, or nothing (204). */
app.post("/api/hooks/dev-jobs/next", async (c) => {
  const d = (await c.req.json().catch(() => ({}))) as { token?: string; run_url?: string };
  if (!(await devHookOk(c, d.token))) return c.json({ ok: false }, 403);
  const job = await claimNextDevJob(
    c.env,
    typeof d.run_url === "string" ? d.run_url.slice(0, 300) : null,
  );
  if (!job) return c.body(null, 204);
  return c.json({ id: job.id, request: job.request, context: job.context });
});

/** The developer agent (GitHub Actions) reporting a job's progress or result. */
app.post("/api/hooks/dev-job", async (c) => {
  const d = (await c.req.json().catch(() => ({}))) as {
    job?: string;
    token?: string;
    status?: string;
    result?: string;
    run_url?: string;
  };
  const expected = await getSetting(c.env, DEV_HOOK_TOKEN_SETTING);
  if (!expected || !d.token || d.token !== expected || !d.job) return c.json({ ok: false }, 403);
  const status =
    d.status === "running" || d.status === "done" || d.status === "failed" ? d.status : null;
  if (!status) return c.json({ ok: false }, 400);
  const ok = await updateDevJob(
    c.env,
    d.job,
    status,
    typeof d.result === "string" ? d.result.slice(0, 6000) : null,
    typeof d.run_url === "string" ? d.run_url.slice(0, 300) : null,
  );
  if (ok && status !== "running") {
    const job = await getDevJob(c.env, d.job);
    await logEvent(c.env, {
      kind: "dev-job",
      actor: "engine",
      user: job?.user ?? null,
      data: { status, request: job?.request.slice(0, 200), result: (d.result ?? "").slice(0, 300) },
    });
  }
  return c.json({ ok });
});

app.use("/api/admin/*", async (c, next) => {
  const user = await currentUser(c.env, getCookie(c, SESSION_COOKIE));
  if (!user) throw new StudioError("Sign in to use the studio.", 401);
  c.set("user", user);
  await next();
});
app.route("/api/admin", adminRoutes);

app.use("/api/studio/*", async (c, next) => {
  const user = await currentUser(c.env, getCookie(c, SESSION_COOKIE));
  if (!user) throw new StudioError("Sign in to use the studio.", 401);
  c.set("user", user);
  await next();
});
app.route("/api/studio", studioRoutes);

app.get("*", (c) => {
  if (c.req.path.startsWith("/api/")) return c.json({ error: "Not found." }, 404);
  return serveStatic(c.req.path) ?? c.json({ error: "Not found." }, 404);
});

app.notFound((c) => c.json({ error: "Not found." }, 404));

app.onError((e, c) => {
  c.header("X-Build", BUILD_ID);
  if (e instanceof StudioError) return c.json({ error: e.message }, e.status as 400);
  console.error("[studio]", e instanceof Error ? e.stack || e.message : e);
  return c.json({ error: "Studio request failed. Retry shortly." }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(cleanupOldBatches(env).catch((e) => console.error("[cleanup]", e)));
    ctx.waitUntil(
      readPendingReferences(env).catch((e) => console.error("[refs]", errorMessage(e))),
    );
    const ids = await activeBatchIds(env);
    for (const id of ids)
      ctx.waitUntil(advanceBatch(env, id).catch((e) => console.error("[cron]", id, e)));
    // Brand memory: one learning run a week over the event stream, plus pruning of old events.
    ctx.waitUntil(
      (async () => {
        if (!(await learnDue(env))) return;
        await setSetting(env, LEARN_LAST_RUN, String(Date.now()));
        await runLearning(env);
        await pruneEvents(env);
      })().catch((e) => console.error("[learn]", errorMessage(e))),
    );
  },
} satisfies ExportedHandler<Env>;
