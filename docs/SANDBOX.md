# Running your own sandbox copy

This is a separate deployment of Max Fashion Studio. It shares **nothing** with the
production site: its own Worker, its own database, its own storage bucket and its own
API keys. Nothing you do here can touch production.

## 1. Prerequisites

- Node.js 22 and pnpm (`npm i -g pnpm`)
- A Cloudflare account (free plan is enough to start)
- `npx wrangler login` once, in a terminal

## 2. Install

```
pnpm install
```

## 3. Create your own resources

Pick a unique name for your copy, for example `max-fashion-sandbox`.

```
npx wrangler d1 create max-fashion-sandbox          # note the database_id it prints
npx wrangler r2 bucket create max-fashion-sandbox
```

Edit `wrangler.jsonc`:

- `name`: `max-fashion-sandbox`
- `d1_databases[0].database_name`: `max-fashion-sandbox`
- `d1_databases[0].database_id`: the id printed above
- `r2_buckets[0].bucket_name`: `max-fashion-sandbox`

## 4. Secrets

```
npx wrangler secret put SESSION_SECRET    # any long random string (32+ chars)
npx wrangler secret put INVITE_CODE       # the code people need to register
```

Engine keys (Higgsfield, Google, OpenAI, fal.ai) are entered later inside the app,
in the Connection dialog. Use your own keys, not the production ones.

## 5. Database tables

```
npx wrangler d1 migrations apply DB --remote
```

## 6. Mood-board photos for the Creative direction workflow (optional)

```
for f in assets/zaid/*.jpg; do
  npx wrangler r2 object put "max-fashion-sandbox/refs/zaid/$(basename "$f")" --file "$f" --content-type image/jpeg --remote
done
```

## 7. Deploy

```
pnpm run deploy
```

The command prints your URL (`https://max-fashion-sandbox.<your-subdomain>.workers.dev`).
The first account that registers becomes the admin.

## 8. Local development

```
cp .dev.vars.example .dev.vars   # then fill in SESSION_SECRET and INVITE_CODE
pnpm dev
```

## 9. Before every deploy

```
pnpm check
```

This runs formatting, lint, type checks, tests and the build. Keep it green.

## Where things are

- `shared/skills.ts`: the ready-made skills (mode 5)
- `shared/zaid.ts`: Creative direction smart skill (mode 7)
- `shared/prompts.ts`: prompts for modes 1-4 and 6
- `shared/pricing.ts`: cost estimates
- `server/engine.ts`: the batch engine
- `server/*.ts`: Higgsfield, Google, OpenAI and fal.ai clients
- `src/studio/`: the web app
