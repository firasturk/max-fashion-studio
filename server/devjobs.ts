/**
 * Developer jobs: a change to the studio itself, asked for in the chat. The Worker cannot edit
 * its own code, so it starts a GitHub Actions run (repository_dispatch) in which the developer
 * agent edits the repository, runs the checks, deploys and calls back with the result.
 */
import { all, first, now, run, uuid } from "./db";
import type { Env } from "./env";
import { StudioError } from "./errors";
import { getSetting, setSetting } from "./settings";

export const GITHUB_TOKEN_SETTING = "github_token";
export const DEV_HOOK_TOKEN_SETTING = "dev_hook_token";
export const DEV_LAST_POLL_SETTING = "dev_last_poll";
export const DEV_REPO = "firasturk/max-fashion-studio";
export const DEV_EVENT = "assistant-change";
/** The account the studio is deployed in (not a secret; the Actions run deploys into it). */
export const CLOUDFLARE_ACCOUNT_ID = "e7331236c05517364ee6a02c2c19a6fd";

export interface DevJob {
  id: string;
  user: string;
  status: "queued" | "running" | "done" | "failed";
  request: string;
  context: string;
  result: string | null;
  run_url: string | null;
  created: number;
  updated: number;
}

export async function githubConfigured(env: Env): Promise<boolean> {
  return !!(await getSetting(env, GITHUB_TOKEN_SETTING));
}

/** When the Actions run last asked for work (the sign that the GitHub secret is in place). */
export async function devLastPoll(env: Env): Promise<number> {
  return Number((await getSetting(env, DEV_LAST_POLL_SETTING)) ?? 0);
}

/** The developer agent is usable once its GitHub run has checked in recently. */
export async function developerReady(env: Env): Promise<boolean> {
  return Date.now() - (await devLastPoll(env)) < 20 * 60_000;
}

/** Oldest queued job becomes running and is handed to the Actions run. */
export async function claimNextDevJob(env: Env, runUrl: string | null): Promise<DevJob | null> {
  await setSetting(env, DEV_LAST_POLL_SETTING, String(now()));
  const next = await first<DevJob>(
    env.DB,
    "SELECT * FROM dev_jobs WHERE status = 'queued' ORDER BY created LIMIT 1",
  );
  if (!next) return null;
  const changed = await run(
    env.DB,
    "UPDATE dev_jobs SET status = 'running', run_url = ?, updated = ? WHERE id = ? AND status = 'queued'",
    runUrl,
    now(),
    next.id,
  );
  return changed ? { ...next, status: "running", run_url: runUrl } : null;
}

/** The secret the Actions run presents when it reports back; created on first use. */
export async function devHookToken(env: Env): Promise<string> {
  const existing = await getSetting(env, DEV_HOOK_TOKEN_SETTING);
  if (existing) return existing;
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  await setSetting(env, DEV_HOOK_TOKEN_SETTING, token);
  return token;
}

const GH = "https://api.github.com";

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "max-fashion-studio",
  };
}

/** Checks the token can reach the repository and may start workflows (contents: write). */
export async function verifyGithubToken(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; message: string }> {
  const r = await fetchImpl(`${GH}/repos/${DEV_REPO}`, {
    headers: ghHeaders(token),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) return { ok: false, message: `GitHub answered ${r.status} for ${DEV_REPO}.` };
  const d = (await r.json()) as { permissions?: { push?: boolean } };
  if (!d.permissions?.push)
    return {
      ok: false,
      message:
        "The token can read the repository but not write to it (Contents: read and write is needed).",
    };
  return { ok: true, message: `Connected to ${DEV_REPO}.` };
}

export async function listDevJobs(
  env: Env,
  userId: string,
  everyone = false,
  limit = 20,
): Promise<DevJob[]> {
  return everyone
    ? all<DevJob>(env.DB, "SELECT * FROM dev_jobs ORDER BY created DESC LIMIT ?", limit)
    : all<DevJob>(
        env.DB,
        "SELECT * FROM dev_jobs WHERE user = ? ORDER BY created DESC LIMIT ?",
        userId,
        limit,
      );
}

export async function getDevJob(env: Env, id: string): Promise<DevJob | null> {
  return (await first<DevJob>(env.DB, "SELECT * FROM dev_jobs WHERE id = ?", id)) ?? null;
}

/**
 * Records the job. The Actions run picks it up on its next poll (every few minutes); when a
 * GitHub token is saved, the run is also started at once.
 */
export async function createDevJob(
  env: Env,
  userId: string,
  request: string,
  context: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DevJob> {
  if (!(await developerReady(env)))
    throw new StudioError(
      "The developer agent is not set up yet (Connection, tab Developer).",
      428,
    );
  const token = await getSetting(env, GITHUB_TOKEN_SETTING);
  const job: DevJob = {
    id: uuid(),
    user: userId,
    status: "queued",
    request: request.slice(0, 6000),
    context: context.slice(0, 4000),
    result: null,
    run_url: null,
    created: now(),
    updated: now(),
  };
  await run(
    env.DB,
    "INSERT INTO dev_jobs (id, user, status, request, context, result, run_url, created, updated) VALUES (?, ?, 'queued', ?, ?, NULL, NULL, ?, ?)",
    job.id,
    job.user,
    job.request,
    job.context,
    job.created,
    job.updated,
  );
  if (!token) return job;
  const r = await fetchImpl(`${GH}/repos/${DEV_REPO}/dispatches`, {
    method: "POST",
    headers: { ...ghHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ event_type: DEV_EVENT, client_payload: { job: job.id } }),
    signal: AbortSignal.timeout(20_000),
  });
  // A refused dispatch is not fatal: the scheduled poll still picks the job up.
  if (r.status !== 204) console.error(`[dev-job] dispatch refused (${r.status})`);
  return job;
}

/** The Actions run reporting its progress or result. */
export async function updateDevJob(
  env: Env,
  id: string,
  status: DevJob["status"] | "queued",
  result: string | null,
  runUrl: string | null,
): Promise<boolean> {
  const changed = await run(
    env.DB,
    "UPDATE dev_jobs SET status = ?, result = COALESCE(?, result), run_url = COALESCE(?, run_url), updated = ? WHERE id = ?",
    status,
    result,
    runUrl,
    now(),
    id,
  );
  return changed > 0;
}
