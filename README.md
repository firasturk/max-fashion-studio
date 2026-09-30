# Max Fashion Image Studio

Batch fashion image production for the Max Fashion creative team. Upload a collection, pick one of four
workflows, generate through the **Higgsfield Cloud API**, review every result against its original, revise
single images, approve, and export a ZIP with the `-AI` naming rules.

The app is a single Cloudflare Worker: a React SPA (Vite) plus a Hono API, with **D1** for metadata,
**R2** for originals and every generated revision, and a **cron trigger** that keeps batches moving
even when nobody has the tab open.

The product brief the implementation follows is in [docs/BRIEF.md](docs/BRIEF.md).

## How generation runs

1. Originals are stored in R2 untouched. A downsized JPEG reference is created in the browser and stored
   alongside for inference and thumbnails.
2. Saving a batch creates one task per output (six for the "Fully AI-generated" workflow, one otherwise).
3. `Generate` marks the batch `running`. The engine loop (`server/engine.ts`) uploads references to
   Higgsfield once, submits up to `MAX_CONCURRENT_GENERATIONS` tasks, polls request status, downloads
   finished images into R2 and sets each task to `review` (or `ready` when automated review is on).
4. The loop is driven from three places with the same idempotent function: the browser tick (every 4 s
   while the batch is open), the optional Higgsfield webhook, and the Worker cron (every minute).
   Every transition is a conditional `UPDATE`, so concurrent drivers never double-submit or double-store.
5. Revisions re-submit only that task with the garment, any identity/first-card reference and the latest
   result attached. Each revision is stored as a new object; the visible result points to the latest.

Without a `GEMINI_API_KEY`, every result lands in **Review needed** and a person approves it. With the
key, Gemini 2.5 Flash estimates centering and product differences and passes clean results as **Ready**.

## Setup

```sh
pnpm install
cp .dev.vars.example .dev.vars   # fill in the values
pnpm db:migrate:local
pnpm dev                          # http://localhost:5173
```

Create the first account from the sign-in screen with the invite code from `.dev.vars`.

### Secrets and variables

| Name                         | Where            | Purpose                                                                                                           |
| ---------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| `HIGGSFIELD_API_KEY`         | secret           | `KEY_ID:KEY_SECRET` from https://cloud.higgsfield.ai (Cloud API credits)                                          |
| `HIGGSFIELD_MODEL`           | var              | Model slug on `api.higgsfield.ai` used for generation (default `nano-banana-pro`; verify on the model's API page) |
| `HIGGSFIELD_BASE_URL`        | var              | `https://api.higgsfield.ai`                                                                                       |
| `MAX_CONCURRENT_GENERATIONS` | var              | Parallel engine requests per batch (default 2)                                                                    |
| `SESSION_SECRET`             | secret           | Long random string that signs session cookies                                                                     |
| `INVITE_CODE`                | secret           | Required to create an account; unset to close registration                                                        |
| `GEMINI_API_KEY`             | secret, optional | Enables automated centering / product review                                                                      |
| `WEBHOOK_TOKEN`              | secret, optional | Protects `/api/hooks/engine`; with `PUBLIC_BASE_URL` enables webhooks                                             |
| `PUBLIC_BASE_URL`            | var, optional    | Public URL of the deployed Worker, e.g. `https://studio.example.workers.dev`                                      |

The Higgsfield Cloud API is billed separately from a higgsfield.ai subscription. Credentials are only
ever stored as Worker secrets; nothing is typed into the browser.

## Deploy

```sh
wrangler d1 create max-fashion-studio        # put the returned id in wrangler.jsonc
wrangler r2 bucket create max-fashion-studio
wrangler secret put HIGGSFIELD_API_KEY
wrangler secret put SESSION_SECRET
wrangler secret put INVITE_CODE
pnpm db:migrate:remote
pnpm deploy
```

Then set `PUBLIC_BASE_URL` in `wrangler.jsonc` and `wrangler secret put WEBHOOK_TOKEN` if you want
completion webhooks in addition to the cron.

## Checks

```sh
pnpm check        # typecheck + lint + unit tests + build
pnpm test         # vitest: naming rules, prompts, config rules, Higgsfield client, password hashing
```

An end-to-end run against a mock of the Higgsfield API (register, upload, generate 18 cards, revise,
approve, export, cross-user isolation, delete) was used to validate the flow; real generation quality
still has to be checked with a small paid batch before production volume.

## Layout

```
server/   Worker: Hono routes, auth, engine loop, Higgsfield + Gemini clients
shared/   Config schema, prompt builder, naming rules (used by both sides)
src/      React client (studio UI, review dialog, ZIP export)
migrations/  D1 schema
tests/    Vitest unit tests
```
