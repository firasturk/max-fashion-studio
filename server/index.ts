import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import type { Env } from "./env";
import { StudioError } from "./errors";
import { authRoutes, currentUser, SESSION_COOKIE } from "./auth";
import { studioRoutes } from "./studio";
import { adminRoutes, cleanupOldBatches } from "./admin";
import { advanceBatch, activeBatchIds } from "./engine";
import type { User } from "@shared/types";
import { serveStatic } from "./static";

type Variables = { user: User };

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
});

app.route("/api/auth", authRoutes);

// Engine webhook: no session, protected by the shared token. Payload is ignored; state is re-read from the engine.
app.post("/api/hooks/engine", async (c) => {
  const token = c.req.query("token");
  const batch = c.req.query("batch");
  if (!c.env.WEBHOOK_TOKEN || !token || token !== c.env.WEBHOOK_TOKEN || !batch)
    return c.json({ ok: false }, 403);
  c.executionCtx.waitUntil(advanceBatch(c.env, batch, (p) => c.executionCtx.waitUntil(p)));
  return c.json({ ok: true });
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
  if (e instanceof StudioError) return c.json({ error: e.message }, e.status as 400);
  console.error("[studio]", e instanceof Error ? e.stack || e.message : e);
  return c.json({ error: "Studio request failed. Retry shortly." }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(cleanupOldBatches(env).catch((e) => console.error("[cleanup]", e)));
    const ids = await activeBatchIds(env);
    for (const id of ids)
      ctx.waitUntil(advanceBatch(env, id).catch((e) => console.error("[cron]", id, e)));
  },
} satisfies ExportedHandler<Env>;
