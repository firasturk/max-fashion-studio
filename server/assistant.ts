/**
 * The studio assistant: a chat inside the app, for the whole team, that answers like the
 * developer and makes the team-level changes itself (revisions, settings, rules, memory) through
 * tools. Anything that needs new code becomes a request to the developer.
 */
import Anthropic from "@anthropic-ai/sdk";
import { BACKDROP_FIX_EDIT } from "@shared/prompts";
import { configSchema } from "@shared/config-schema";
import { validateConfig, type Config } from "@shared/config";
import { storeDirectionRules, type DirectionRule } from "@shared/direction-rules";
import type { User } from "@shared/types";
import { all, first, now, run } from "./db";
import type { Env } from "./env";
import { StudioError, errorMessage } from "./errors";
import { advanceBatch, directionRules, DIRECTION_RULES_SETTING } from "./engine";
import { logEvent } from "./events";
import { activeMemoryLines, addMemory } from "./memory";
import { notify } from "./notify";
import { createDevJob, githubConfigured } from "./devjobs";
import { resolveAnthropicKey, setSetting } from "./settings";
import { listSkills } from "./skills";

export const ASSISTANT_MODEL = "claude-opus-5-5";
const MAX_ROUNDS = 6;

export interface ChatImage {
  media_type: "image/jpeg" | "image/png" | "image/webp";
  data: string;
}

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  /** Pictures the user attached to this message (base64). */
  images?: ChatImage[];
}

export interface AssistantAction {
  tool: string;
  summary: string;
  /** A developer job started for this action: the chat follows it until it reports back. */
  job?: string;
}

interface BatchRow {
  id: string;
  owner: string;
  name: string;
  config: string;
  state: string;
}

interface TaskRow {
  id: string;
  source: string;
  card: number;
  status: string;
  output: string | null;
  qa: string | null;
  error: string | null;
  prompt: string;
  brief: string | null;
  attempts: number;
  model: string | null;
  name: string;
  reference_key: string | null;
}

const SETTABLE_FIELDS = [
  "prompt",
  "count",
  "ratio",
  "size",
  "model",
  "skill",
  "market",
  "colors",
  "output",
  "outputSize",
  "outputQuality",
  "originals",
  "economy",
  "center",
  "backdrop",
  "modelDescription",
  "input",
] as const;

const TOOLS: Anthropic.Tool[] = [
  {
    name: "list_images",
    description:
      "List the images of the current batch with their id, product name, card, status, review concern and error. Use it to find the images the user talks about (the grey ones, the failed ones, product 169577759...).",
    input_schema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description: "Only this status: queued, processing, ready, review, approved or failed.",
        },
        product: { type: "string", description: "Only images whose product name contains this." },
        limit: { type: "integer", description: "At most this many (default 60)." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_image",
    description:
      "Details of one image: the exact prompt sent to the engine, the brief (scene, pose, light, framing), the automatic review, the error and the attempts.",
    input_schema: {
      type: "object",
      properties: { task_id: { type: "string" } },
      required: ["task_id"],
      additionalProperties: false,
    },
  },
  {
    name: "revise_images",
    description:
      "Generate the given images again with a revision instruction in English for the image engine (for example a new pose, a cleaner background, fix the hands, keep the face). The current result stays until the new one arrives. Use the exact wording a careful art director would send to the engine; keep the garment, face and framing unless the user asks otherwise.",
    input_schema: {
      type: "object",
      properties: {
        task_ids: { type: "array", items: { type: "string" }, minItems: 1 },
        instruction: { type: "string" },
        pose_from_attachment: {
          type: "integer",
          description:
            "When the user attached a photo of the pose they want in their LAST message: its number among the attachments (1 = first). The engine then copies only that photo's body pose. Omit when no attachment should be used.",
        },
      },
      required: ["task_ids", "instruction"],
      additionalProperties: false,
    },
  },
  {
    name: "rerun_with_backdrop_colour",
    description:
      "Backdrop colour approach only: generate the given images again from the original photo with the requested backdrop colour, for results that came out grey or the wrong colour.",
    input_schema: {
      type: "object",
      properties: { task_ids: { type: "array", items: { type: "string" }, minItems: 1 } },
      required: ["task_ids"],
      additionalProperties: false,
    },
  },
  {
    name: "retry_images",
    description: "Retry failed images from scratch.",
    input_schema: {
      type: "object",
      properties: { task_ids: { type: "array", items: { type: "string" }, minItems: 1 } },
      required: ["task_ids"],
      additionalProperties: false,
    },
  },
  {
    name: "approve_images",
    description: "Mark finished images as approved.",
    input_schema: {
      type: "object",
      properties: { task_ids: { type: "array", items: { type: "string" }, minItems: 1 } },
      required: ["task_ids"],
      additionalProperties: false,
    },
  },
  {
    name: "update_batch_setting",
    description: `Change one setting of the current batch (it must not be running): one of ${SETTABLE_FIELDS.join(", ")}. "prompt" is the creative direction or extra request text; "colors" is the comma-separated backdrop colours; "count" images per photo (1-6); "ratio" 2:3, 3:4, 4:5 or 1:1; "size" 1K, 2K or 4K; "skill" a skill id from the context. Takes effect on images generated after the change.`,
    input_schema: {
      type: "object",
      properties: {
        field: { type: "string", enum: [...SETTABLE_FIELDS] },
        value: { description: "The new value (string, number or boolean as the field needs)." },
      },
      required: ["field", "value"],
      additionalProperties: false,
    },
  },
  {
    name: "add_direction_rule",
    description:
      "Add a fixed rule to Creative direction (approach 7): a short English instruction every prompt will follow from now on. Use it when the user wants a permanent change of behaviour, not a one-off revision.",
    input_schema: {
      type: "object",
      properties: { title: { type: "string" }, text: { type: "string" } },
      required: ["title", "text"],
      additionalProperties: false,
    },
  },
  {
    name: "remember",
    description:
      "Store a lesson in the brand memory so every later prompt follows it: scope 'global' or 'skill:<id>'. Use it for lasting preferences the user states (we never want X, always do Y for skill Z).",
    input_schema: {
      type: "object",
      properties: {
        scope: { type: "string" },
        title: { type: "string" },
        text: { type: "string" },
        kind: { type: "string", enum: ["rule", "avoid"] },
      },
      required: ["scope", "title", "text"],
      additionalProperties: false,
    },
  },
  {
    name: "change_system",
    description:
      "Change the studio itself: anything the other tools cannot do (a new feature, a new button or option, different behaviour of an approach or a skill, a fix for a bug, wording in the interface, a new rule baked into the engine). Starts the developer agent, which edits the code, tests it, deploys it and reports back in a few minutes; the user does not approve anything. Write the request as a precise brief in English: what to change, where it shows, how it should behave, and what the user said in their own words.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One line, what changes." },
        details: {
          type: "string",
          description:
            "The full brief for the developer agent, in English, with the user's words quoted.",
        },
      },
      required: ["summary", "details"],
      additionalProperties: false,
    },
  },
];

function qaConcern(qa: string | null): string {
  if (!qa) return "";
  try {
    const q = JSON.parse(qa) as { productConcern?: string; sameFace?: boolean; centered?: boolean };
    return [
      q.productConcern,
      q.sameFace === false ? "different face" : "",
      q.centered === false ? "off centre" : "",
    ]
      .filter(Boolean)
      .join("; ");
  } catch {
    return "";
  }
}

async function batchTasks(env: Env, batchId: string): Promise<TaskRow[]> {
  return all<TaskRow>(
    env.DB,
    "SELECT t.id, t.source, t.card, t.status, t.output, t.qa, t.error, t.prompt, t.brief, t.attempts, t.model, s.name, s.reference_key FROM tasks t JOIN sources s ON s.id = t.source WHERE t.batch = ? ORDER BY s.name, t.card",
    batchId,
  );
}

/** The studio state the assistant sees before answering. */
async function buildContext(
  env: Env,
  user: User,
  batch: BatchRow | null,
  taskId: string | null,
): Promise<{ system: string; images: Anthropic.ImageBlockParam[] }> {
  const skills = await listSkills(env);
  const lines: string[] = [
    `You are the studio assistant of Max Fashion Studio, the AI fashion-image studio this team uses. You answer exactly like the developer who built it would in chat: short, concrete, friendly, in the language the user writes (Arabic or English; Arabic users often write in Levantine dialect, answer in natural Arabic). You act for the team, not only for admins.`,
    `You have full authority, for every member of the team, and nobody approves anything: when the user asks for a change, you do it. Through your tools you re-generate images with a revision (new pose, cleaner background, fix hands, keep the face...), re-run wrong backdrop colours, retry failed images, approve images, change the batch settings, add a fixed rule to Creative direction, store a lesson in the brand memory, and read any image's prompt, brief, review and error. For anything else, the studio itself changes: use change_system with a precise brief, and the developer agent edits the code, tests, deploys and reports back here in a few minutes. Never answer "I cannot" or "ask the developer": either a tool does it now, or change_system does it in minutes. Never ask for permission; ask a question only when the request is genuinely ambiguous in a way that would change what gets built.`,
    `Rules of the studio you must respect: the garment is never changed; real faces are preserved; wording is catalogue-safe (no body-focused or sensual language, plain product terms for underwear and swimwear); revisions keep the framing of the original crop unless asked. Write engine instructions in English even when you answer in Arabic.`,
    `The user can attach pictures to a chat message: a screenshot with marks showing what is wrong, a photo of the pose or look they want, an example from a competitor. Read them carefully and act on them. A pose or look the user wants copied goes to the engine through revise_images with pose_from_attachment; a marked screenshot tells you what to change in words. When the user talks about "this image" they mean the image open on screen (below). When they describe images (the grey ones, the failed ones), call list_images first to find them. After a tool call, say in one or two lines what happened and what the user should expect (a revision takes about a minute, the old result stays until the new one arrives, refresh is not needed).`,
    `Today: ${new Date().toISOString().slice(0, 10)}. User: ${user.name} (${user.role}).`,
    `Skills (id: title): ${skills.map((s) => `${s.id}: ${s.title}`).join("; ")}. Approaches: 1 Mannequin to model, 2 New face lifestyle, 3 New poses, 4 Fresh backgrounds, 5 Skill campaign, 6 Backdrop colour, 7 Creative direction, 8 Skill campaign new model, 9 No prompt.`,
  ];
  const images: Anthropic.ImageBlockParam[] = [];
  if (batch) {
    let cfg: Partial<Config> = {};
    try {
      cfg = JSON.parse(batch.config) as Config;
    } catch {
      /* unreadable */
    }
    const tasks = await batchTasks(env, batch.id);
    const counts = new Map<string, number>();
    for (const t of tasks) counts.set(t.status, (counts.get(t.status) ?? 0) + 1);
    lines.push(
      `CURRENT BATCH "${batch.name}" (id ${batch.id}), state ${batch.state}. Settings: approach ${cfg.mode}, skill ${cfg.skill}, model ${cfg.model}, size ${cfg.size}, ratio ${cfg.ratio}, count ${cfg.count}, colours "${cfg.colors}", output ${cfg.output}/${cfg.outputSize}, direction text: "${(cfg.prompt ?? "").slice(0, 400)}". Images: ${tasks.length} (${[...counts].map(([k, n]) => `${n} ${k}`).join(", ")}).`,
    );
    if (cfg.mode === "7") {
      const rules = await directionRules(env);
      lines.push(
        `Creative direction fixed rules: ${rules.map((r) => `${r.title || r.key}${r.enabled ? "" : " (off)"}`).join(", ")}.`,
      );
    }
    const memory = await activeMemoryLines(env, cfg.skill ?? "");
    if (memory.length) lines.push(`Brand memory in force: ${memory.join(" | ")}`);
    const task = taskId ? tasks.find((t) => t.id === taskId) : null;
    if (task) {
      let brief = "";
      try {
        const b = JSON.parse(task.brief ?? "null") as Record<string, unknown> | null;
        if (b)
          brief = ["scene", "pose", "light", "framing", "faceMode"]
            .map((k) => (b[k] ? `${k}: ${String(b[k]).slice(0, 200)}` : ""))
            .filter(Boolean)
            .join("; ");
      } catch {
        /* no brief */
      }
      lines.push(
        `IMAGE OPEN ON SCREEN: task ${task.id}, product ${task.name}, card ${task.card}, status ${task.status}, attempts ${task.attempts}${task.model ? `, engine ${task.model}` : ""}. Review: ${qaConcern(task.qa) || "no concern"}. Error: ${task.error || "none"}. Brief: ${brief || "none"}. Prompt sent (start): ${task.prompt.slice(0, 1200)}`,
      );
      // The original (small reference) and the result, so the assistant sees what the user sees.
      const ref = task.reference_key ? await env.BUCKET.get(task.reference_key) : null;
      if (ref) {
        images.push({
          type: "image",
          source: {
            type: "base64",
            media_type: (ref.httpMetadata?.contentType as "image/jpeg") || "image/jpeg",
            data: toBase64(await ref.arrayBuffer()),
          },
        });
        lines.push("Attached image 1: the original product photo.");
      }
      const out = task.output ? await env.BUCKET.get(task.output) : null;
      if (out && out.size < 2_500_000) {
        images.push({
          type: "image",
          source: {
            type: "base64",
            media_type: (out.httpMetadata?.contentType as "image/png") || "image/png",
            data: toBase64(await out.arrayBuffer()),
          },
        });
        lines.push(`Attached image ${images.length}: the current result.`);
      }
    }
  } else lines.push("No batch is open. The user can open one from Batches.");
  return { system: lines.join("\n\n"), images };
}

function fromBase64(data: string): ArrayBuffer {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Runs one tool against the studio. Returns the text handed back to the model. */
async function runTool(
  env: Env,
  user: User,
  batch: BatchRow | null,
  name: string,
  input: Record<string, unknown>,
  actions: AssistantAction[],
  background: (p: Promise<unknown>) => void,
  attachments: ChatImage[] = [],
): Promise<string> {
  const need = (): BatchRow => {
    if (!batch) throw new StudioError("No batch is open.");
    return batch;
  };
  const ids = (v: unknown): string[] =>
    Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, 500) : [];
  const kick = async (b: BatchRow) => {
    await run(
      env.DB,
      "UPDATE batches SET state = 'running', last_error = NULL, updated = ? WHERE id = ?",
      now(),
      b.id,
    );
    await advanceBatch(env, b.id, { background, deferSync: true });
  };
  switch (name) {
    case "list_images": {
      const b = need();
      const tasks = await batchTasks(env, b.id);
      const status = typeof input.status === "string" ? input.status : "";
      const product = typeof input.product === "string" ? input.product : "";
      const limit = Math.min(200, Math.max(1, Number(input.limit) || 60));
      const list = tasks
        .filter((t) => (!status || t.status === status) && (!product || t.name.includes(product)))
        .slice(0, limit)
        .map(
          (t) =>
            `${t.id} | ${t.name} | card ${t.card} | ${t.status}${t.output ? "" : " (no result)"}${qaConcern(t.qa) ? ` | review: ${qaConcern(t.qa)}` : ""}${t.error ? ` | error: ${t.error.slice(0, 120)}` : ""}`,
        );
      return list.length ? list.join("\n") : "No images match.";
    }
    case "get_image": {
      const b = need();
      const t = (await batchTasks(env, b.id)).find((x) => x.id === input.task_id);
      if (!t) return "No image with that id in this batch.";
      return `id ${t.id}\nproduct ${t.name}, card ${t.card}, status ${t.status}, attempts ${t.attempts}, engine ${t.model ?? "batch default"}\nreview: ${qaConcern(t.qa) || "none"}\nerror: ${t.error ?? "none"}\nbrief: ${t.brief ?? "none"}\nprompt:\n${t.prompt}`;
    }
    case "revise_images":
    case "rerun_with_backdrop_colour": {
      const b = need();
      const instruction =
        name === "rerun_with_backdrop_colour"
          ? BACKDROP_FIX_EDIT
          : String(input.instruction ?? "").trim();
      if (!instruction) return "An instruction is required.";
      // A pose photo attached in the chat is stored once and handed to the engine with the revision.
      let editRef: string | null = null;
      const n = Number(input.pose_from_attachment);
      if (name === "revise_images" && n >= 1) {
        const img = attachments[n - 1];
        if (!img) return `There is no attachment number ${n} in the last message.`;
        editRef = `assistant/${b.id}/${crypto.randomUUID()}.${img.media_type === "image/png" ? "png" : img.media_type === "image/webp" ? "webp" : "jpg"}`;
        await env.BUCKET.put(editRef, fromBase64(img.data), {
          httpMetadata: { contentType: img.media_type },
        });
      }
      let changed = 0;
      for (const id of ids(input.task_ids))
        changed += await run(
          env.DB,
          "UPDATE tasks SET status = 'queued', edit = ?, edit_ref = ?, error = NULL, updated = ? WHERE id = ? AND batch = ? AND output IS NOT NULL AND status IN ('ready','review','approved','failed')",
          instruction.slice(0, 3000),
          editRef,
          now(),
          id,
          b.id,
        );
      if (!changed)
        return "None of those images can be revised right now (no result yet, or still generating).";
      await logEvent(env, {
        kind: "revise-all",
        user: user.id,
        batch: b.id,
        data: { edit: instruction.slice(0, 500), count: changed, via: "assistant" },
      });
      await kick(b);
      actions.push({
        tool: name,
        summary: `${changed} image${changed === 1 ? "" : "s"} queued: ${instruction.slice(0, 80)}`,
      });
      return `${changed} image(s) queued for regeneration. The current results stay until the new ones arrive.`;
    }
    case "retry_images": {
      const b = need();
      let changed = 0;
      for (const id of ids(input.task_ids))
        changed += await run(
          env.DB,
          "UPDATE tasks SET status = 'queued', error = NULL, brief = NULL, attempts = 0, updated = ? WHERE id = ? AND batch = ? AND status = 'failed'",
          now(),
          id,
          b.id,
        );
      if (!changed) return "None of those images is in the failed state.";
      await kick(b);
      actions.push({
        tool: name,
        summary: `${changed} failed image${changed === 1 ? "" : "s"} retried`,
      });
      return `${changed} image(s) retried.`;
    }
    case "approve_images": {
      const b = need();
      let changed = 0;
      for (const id of ids(input.task_ids))
        changed += await run(
          env.DB,
          "UPDATE tasks SET status = 'approved', updated = ? WHERE id = ? AND batch = ? AND output IS NOT NULL AND status IN ('ready','review')",
          now(),
          id,
          b.id,
        );
      actions.push({ tool: name, summary: `${changed} image${changed === 1 ? "" : "s"} approved` });
      return `${changed} image(s) approved.`;
    }
    case "update_batch_setting": {
      const b = need();
      if (b.state === "running")
        return "The batch is running; pause it first, then change the setting.";
      const field = String(input.field);
      if (!(SETTABLE_FIELDS as readonly string[]).includes(field))
        return `"${field}" cannot be changed here.`;
      const previous = JSON.parse(b.config) as Config;
      const parsed = configSchema.safeParse({ ...previous, [field]: input.value });
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return `Invalid value for ${field}: ${issue?.message ?? "not accepted"}.`;
      }
      const config = { ...parsed.data, mode: previous.mode } as Config;
      const problem = validateConfig(config);
      if (problem) return `Not accepted: ${problem}`;
      await run(
        env.DB,
        "UPDATE batches SET config = ?, updated = ? WHERE id = ?",
        JSON.stringify(config),
        now(),
        b.id,
      );
      // Prompts not generated yet follow the new settings on their next pass.
      await run(
        env.DB,
        "UPDATE tasks SET brief = NULL, prompt = '' WHERE batch = ? AND output IS NULL AND status NOT IN ('processing','finalizing')",
        b.id,
      );
      await logEvent(env, {
        kind: "config",
        user: user.id,
        batch: b.id,
        mode: config.mode,
        skill: config.skill,
        data: { field, value: input.value, via: "assistant" },
      });
      actions.push({ tool: name, summary: `${field} set to ${JSON.stringify(input.value)}` });
      return `${field} is now ${JSON.stringify(input.value)}. Images generated from now on use it; already generated ones need a revision or a re-run.`;
    }
    case "add_direction_rule": {
      const title = String(input.title ?? "")
        .trim()
        .slice(0, 80);
      const text = String(input.text ?? "")
        .trim()
        .slice(0, 4000);
      if (!text) return "The rule text is required.";
      const rules = await directionRules(env);
      const key = `team-${now().toString(36)}`;
      const next: DirectionRule[] = [...rules, { key, title, text, enabled: true }];
      await setSetting(env, DIRECTION_RULES_SETTING, JSON.stringify(storeDirectionRules(next)));
      await logEvent(env, {
        kind: "rule",
        user: user.id,
        mode: "7",
        data: { summary: `added "${title}": ${text.slice(0, 120)}`, via: "assistant" },
      });
      actions.push({ tool: name, summary: `rule added: ${title}` });
      return `Rule "${title}" added to Creative direction; every prompt written from now on follows it.`;
    }
    case "remember": {
      const scope = /^(global|skill:[a-z0-9-]{1,60})$/.test(String(input.scope))
        ? String(input.scope)
        : "global";
      const item = await addMemory(env, {
        scope,
        kind: input.kind === "avoid" ? "avoid" : "rule",
        title: String(input.title ?? "").slice(0, 80),
        text: String(input.text ?? "").slice(0, 600),
        status: "active",
      });
      await logEvent(env, {
        kind: "memory",
        user: user.id,
        data: { action: "added", title: item.title, scope, via: "assistant" },
      });
      actions.push({ tool: name, summary: `remembered: ${item.title}` });
      return `Stored in the brand memory (${scope}).`;
    }
    case "change_system": {
      const summary = String(input.summary ?? "").slice(0, 200);
      const details = String(input.details ?? "").slice(0, 5000);
      await logEvent(env, {
        kind: "request",
        user: user.id,
        batch: batch?.id ?? null,
        data: { summary, details, by: user.name },
      });
      if (!(await githubConfigured(env))) {
        background(
          notify(
            env,
            `Studio request from ${user.name}: ${summary}`,
            `${details}\n\nBatch: ${batch?.name ?? "none"} (${batch?.id ?? "-"})`,
          ).catch(() => {}),
        );
        actions.push({ tool: name, summary: `recorded for the developer: ${summary}` });
        return "The developer agent is not connected yet (an admin connects GitHub in Connection, tab Developer), so the request was recorded and sent to the notification channel instead.";
      }
      const context = [
        `Requested by ${user.name} (${user.role}).`,
        batch
          ? `Open batch: "${batch.name}" (${batch.id}), state ${batch.state}, settings ${batch.config.slice(0, 1500)}.`
          : "No batch open.",
      ].join("\n");
      const job = await createDevJob(env, user.id, `${summary}\n\n${details}`, context);
      actions.push({ tool: name, summary: `changing the studio: ${summary}`, job: job.id });
      return `Developer job ${job.id} started. The studio is being changed now; it takes a few minutes and the chat shows the result when it is deployed. Tell the user it is in progress, without promising a time shorter than five minutes.`;
    }
    default:
      return `Unknown tool ${name}.`;
  }
}

export async function chat(
  env: Env,
  user: User,
  batch: BatchRow | null,
  taskId: string | null,
  history: ChatTurn[],
  background: (p: Promise<unknown>) => void,
): Promise<{ reply: string; actions: AssistantAction[] }> {
  const { key } = await resolveAnthropicKey(env);
  if (!key) throw new StudioError("Add the Claude API key in Connection first (tab Claude).", 428);
  const client = new Anthropic({ apiKey: key, maxRetries: 2, timeout: 120_000 });
  const { system, images } = await buildContext(env, user, batch, taskId);
  const turns = history.slice(-20);
  const last = turns.at(-1);
  const attachments = last?.role === "user" ? (last.images ?? []).slice(0, 4) : [];
  const messages: Anthropic.MessageParam[] = turns.map((t, i) => {
    const own: Anthropic.ImageBlockParam[] = (t.images ?? []).slice(0, 4).map((img) => ({
      type: "image",
      source: { type: "base64", media_type: img.media_type, data: img.data },
    }));
    const context = i === turns.length - 1 && t.role === "user" ? images : [];
    if (t.role === "assistant" || (!own.length && !context.length))
      return { role: t.role, content: t.text };
    const label = own.length
      ? `\n\n(The user attached ${own.length} picture${own.length === 1 ? "" : "s"} to this message: ${own.length === 1 ? "it is" : "they are"} the last ${own.length === 1 ? "image" : own.length + " images"} above, numbered 1 to ${own.length} in order.)`
      : "";
    return { role: "user", content: [...context, ...own, { type: "text", text: t.text + label }] };
  });
  const actions: AssistantAction[] = [];
  let reply = "";
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await client.messages.create({
      model: ASSISTANT_MODEL,
      max_tokens: 4000,
      system,
      tools: TOOLS,
      output_config: { effort: "medium" },
      messages,
    });
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (text) reply = text;
    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (response.stop_reason !== "tool_use" || !toolUses.length) break;
    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const t of toolUses) {
      let content: string;
      try {
        content = await runTool(
          env,
          user,
          batch,
          t.name,
          (t.input ?? {}) as Record<string, unknown>,
          actions,
          background,
          attachments,
        );
      } catch (e) {
        content = `Failed: ${errorMessage(e)}`;
      }
      results.push({ type: "tool_result", tool_use_id: t.id, content });
    }
    messages.push({ role: "user", content: results });
  }
  await logEvent(env, {
    kind: "assistant",
    user: user.id,
    batch: batch?.id ?? null,
    task: taskId,
    data: {
      asked: (last?.text ?? "").slice(0, 300),
      replied: reply.slice(0, 300),
      actions: actions.map((a) => a.summary),
    },
  });
  return { reply: reply || "Done.", actions };
}

export async function verifyAnthropicKey(key: string): Promise<{ ok: boolean; message: string }> {
  try {
    const client = new Anthropic({ apiKey: key, maxRetries: 0, timeout: 20_000 });
    await client.models.retrieve(ASSISTANT_MODEL);
    return { ok: true, message: `Connected. The assistant runs on ${ASSISTANT_MODEL}.` };
  } catch (e) {
    return { ok: false, message: errorMessage(e) };
  }
}

export async function batchForAssistant(
  env: Env,
  user: User,
  id: string | null,
): Promise<BatchRow | null> {
  if (!id) return null;
  const b = await first<BatchRow>(
    env.DB,
    "SELECT id, owner, name, config, state FROM batches WHERE id = ? AND (owner = ? OR ? = 'admin')",
    id,
    user.id,
    user.role,
  );
  return b ?? null;
}
