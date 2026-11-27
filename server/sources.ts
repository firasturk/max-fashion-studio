/** Adds one uploaded photo to a batch: the source row and the tasks its workflow needs. */
import type { Env } from "./env";
import { now, uuid } from "./db";
import { cardsPerSource, createsTasks, type Config } from "@shared/config";
import { buildPrompt } from "@shared/prompts";

export interface NewSource {
  id: string;
  batch: string;
  name: string;
  stem: string;
  key: string;
  referenceKey: string | null;
  mime: string;
  size: number;
  role: "lead" | "supporting";
}

export async function insertSource(env: Env, config: Config, s: NewSource): Promise<void> {
  const statements = [
    env.DB.prepare(
      "INSERT INTO sources (id, batch, name, stem, key, reference_key, mime, size, role, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(s.id, s.batch, s.name, s.stem, s.key, s.referenceKey, s.mime, s.size, s.role, now()),
  ];
  if (createsTasks(config, s.role)) {
    for (let card = 1; card <= cardsPerSource(config); card++) {
      statements.push(
        env.DB.prepare(
          "INSERT INTO tasks (id, batch, source, card, status, prompt, updated) VALUES (?, ?, ?, ?, 'queued', ?, ?)",
        ).bind(uuid(), s.batch, s.id, card, buildPrompt(config, card), now()),
      );
    }
  }
  await env.DB.batch(statements);
}
