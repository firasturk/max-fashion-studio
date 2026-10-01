import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import type { Env } from "./env";
import { StudioError } from "./errors";
import { first, run, now, uuid } from "./db";
import type { User } from "@shared/types";
import { getSetting, INVITE_CODE_SETTING } from "./settings";

const SESSION_COOKIE = "studio_session";
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days
const PBKDF2_ITERATIONS = 100_000; // Cloudflare Workers cap PBKDF2 at 100k iterations

const enc = new TextEncoder();

function toHex(buf: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    256,
  );
  return toHex(bits);
}

/** Format: pbkdf2$iterations$saltHex$hashHex */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toHex(salt)}$${hash}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, saltHex, hash] = stored.split("$");
  if (scheme !== "pbkdf2" || !iter || !saltHex || !hash) return false;
  const candidate = await pbkdf2(password, fromHex(saltHex), Number(iter));
  return timingSafeEqual(candidate, hash);
}

async function hmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(value)));
}

function sessionSecret(env: Env): string {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 16) {
    throw new StudioError("Server is missing SESSION_SECRET. Set it as a secret.", 503);
  }
  return env.SESSION_SECRET;
}

/** Cookie value is `sessionId.signature` so a forged id without the secret is rejected before any query. */
async function signSession(env: Env, id: string): Promise<string> {
  return `${id}.${await hmac(sessionSecret(env), id)}`;
}

async function readSessionId(env: Env, cookie: string | undefined): Promise<string | null> {
  if (!cookie) return null;
  const [id, sig] = cookie.split(".");
  if (!id || !sig) return null;
  const expected = await hmac(sessionSecret(env), id);
  return timingSafeEqual(sig, expected) ? id : null;
}

export async function currentUser(env: Env, cookie: string | undefined): Promise<User | null> {
  const id = await readSessionId(env, cookie);
  if (!id) return null;
  const row = await first<{
    id: string;
    email: string;
    name: string;
    role: string;
    disabled: number;
    expires: number;
  }>(
    env.DB,
    "SELECT u.id, u.email, u.name, u.role, u.disabled, s.expires FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?",
    id,
  );
  if (!row) return null;
  if (row.expires < now() || row.disabled) {
    await run(env.DB, "DELETE FROM sessions WHERE id = ?", id);
    return null;
  }
  // Cheap activity marker for the admin page (at most once a minute per session).
  void run(
    env.DB,
    "UPDATE users SET last_seen = ? WHERE id = ? AND (last_seen IS NULL OR last_seen < ?)",
    now(),
    row.id,
    now() - 60_000,
  );
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role === "admin" ? "admin" : "member",
  };
}

/** Invite code: the one saved from the admin page wins over the INVITE_CODE secret. */
export async function currentInviteCode(env: Env): Promise<string | null> {
  const stored = await getSetting(env, INVITE_CODE_SETTING);
  return stored || env.INVITE_CODE || null;
}

/** A valid-looking hash that never matches; keeps login timing uniform for unknown emails. */
const DUMMY_HASH = `pbkdf2$${PBKDF2_ITERATIONS}$${"00".repeat(16)}$${"00".repeat(32)}`;

const credentials = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(10).max(200),
});

const registration = credentials.extend({
  name: z.string().trim().min(1).max(80),
  invite: z.string().max(200),
});

type Variables = { user: User | null };

export const authRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

authRoutes.get("/me", async (c) => {
  const user = await currentUser(c.env, getCookie(c, SESSION_COOKIE));
  return c.json({ user, registrationOpen: !!(await currentInviteCode(c.env)) });
});

authRoutes.post("/register", async (c) => {
  const inviteCode = await currentInviteCode(c.env);
  if (!inviteCode) throw new StudioError("Registration is disabled on this server.", 403);
  const parsed = registration.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new StudioError(
      "Enter a name, a valid email, a 10+ character password and the invite code.",
    );
  }
  const { email, password, name, invite } = parsed.data;
  if (!timingSafeEqual(invite, inviteCode)) throw new StudioError("Invite code is incorrect.", 403);
  const existing = await first(c.env.DB, "SELECT id FROM users WHERE email = ?", email);
  if (existing) throw new StudioError("An account with this email already exists.", 409);
  const id = uuid();
  const count = await first<{ n: number }>(c.env.DB, "SELECT COUNT(*) AS n FROM users");
  const role = (count?.n ?? 0) === 0 ? "admin" : "member";
  await run(
    c.env.DB,
    "INSERT INTO users (id, email, name, password_hash, role, created) VALUES (?, ?, ?, ?, ?, ?)",
    id,
    email,
    name,
    await hashPassword(password),
    role,
    now(),
  );
  await startSession(c, id);
  return c.json({ user: { id, email, name, role } });
});

authRoutes.post("/login", async (c) => {
  const parsed = credentials.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw new StudioError("Enter your email and password.");
  const row = await first<{
    id: string;
    email: string;
    name: string;
    role: string;
    disabled: number;
    password_hash: string;
  }>(
    c.env.DB,
    "SELECT id, email, name, role, disabled, password_hash FROM users WHERE email = ?",
    parsed.data.email,
  );
  // Always run one hash so a missing account takes as long as a wrong password.
  const ok = await verifyPassword(parsed.data.password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !ok) throw new StudioError("Email or password is incorrect.", 401);
  if (row.disabled) throw new StudioError("This account is disabled. Ask your admin.", 403);
  await startSession(c, row.id);
  return c.json({
    user: {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role === "admin" ? "admin" : "member",
    },
  });
});

authRoutes.post("/logout", async (c) => {
  const id = await readSessionId(c.env, getCookie(c, SESSION_COOKIE));
  if (id) await run(c.env.DB, "DELETE FROM sessions WHERE id = ?", id);
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

type Ctx = Context<{ Bindings: Env; Variables: Variables }>;

async function startSession(c: Ctx, userId: string) {
  const id = uuid();
  await run(
    c.env.DB,
    "INSERT INTO sessions (id, user_id, created, expires) VALUES (?, ?, ?, ?)",
    id,
    userId,
    now(),
    now() + SESSION_TTL,
  );
  const secure = new URL(c.req.url).protocol === "https:";
  setCookie(c, SESSION_COOKIE, await signSession(c.env, id), {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure,
    maxAge: SESSION_TTL / 1000,
  });
}

export { SESSION_COOKIE };
