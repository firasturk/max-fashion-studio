/**
 * Skills the team can manage: the built-in list from shared/skills.ts, overlaid with rows from the
 * `skills` table (an edit of a built-in uses the same id; a deleted built-in is a hidden row; a
 * new skill is any other id).
 */
import type { Env } from "./env";
import { all, first } from "./db";
import { getSetting, setSetting } from "./settings";
import { SKILLS, deriveSkill, type SkillDef, type SkillDraft } from "@shared/skills";
import type { SkillInfo } from "@shared/types";

interface SkillRow extends SkillDraft {
  hidden: number;
  auto: number;
}

function rowToInfo(r: SkillRow, builtIn: boolean): SkillInfo {
  return {
    id: r.id,
    title: r.title,
    caption: r.caption,
    description: r.description,
    goal: r.goal,
    library: r.library,
    builtIn,
    edited: builtIn,
    auto: !!r.auto,
    favourite: false,
  };
}

function builtInInfo(s: SkillDef): SkillInfo {
  return {
    id: s.id,
    title: s.title,
    caption: s.caption,
    description: s.description,
    goal: s.goal ?? "",
    library: s.library,
    builtIn: true,
    edited: false,
    auto: true,
    favourite: false,
  };
}

const ORDER_SETTING = "skills_order";
const favSetting = (userId: string) => `skill_favs_${userId}`;

async function readIds(env: Env, name: string): Promise<string[]> {
  try {
    const v = JSON.parse((await getSetting(env, name)) || "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Team-wide display order; ids missing from the saved order keep their natural place at the end. */
export async function saveSkillsOrder(env: Env, ids: string[]): Promise<void> {
  await setSetting(env, ORDER_SETTING, JSON.stringify(ids.slice(0, 200)));
}

export async function setFavourite(env: Env, userId: string, id: string, on: boolean): Promise<void> {
  const favs = new Set(await readIds(env, favSetting(userId)));
  if (on) favs.add(id);
  else favs.delete(id);
  await setSetting(env, favSetting(userId), JSON.stringify([...favs]));
}

/** Skills as the team sees them: favourites of `userId` first, then the saved order. */
export async function listSkills(env: Env, userId?: string): Promise<SkillInfo[]> {
  const list = await listSkillsRaw(env);
  const thumbs = await all<{ skill: string; id: string }>(
    env.DB,
    "SELECT r.skill, r.id FROM refs r JOIN (SELECT skill, MIN(created) AS c FROM refs GROUP BY skill) m ON m.skill = r.skill AND m.c = r.created",
  );
  const thumbOf = new Map(thumbs.map((t) => [t.skill, t.id]));
  const order = await readIds(env, ORDER_SETTING);
  const favs = new Set(userId ? await readIds(env, favSetting(userId)) : []);
  const rank = (id: string) => {
    const i = order.indexOf(id);
    return i === -1 ? order.length + list.findIndex((s) => s.id === id) : i;
  };
  return list
    .map((s) => ({ ...s, favourite: favs.has(s.id), thumb: thumbOf.get(s.id) }))
    .sort((a, b) => Number(b.favourite) - Number(a.favourite) || rank(a.id) - rank(b.id));
}

async function listSkillsRaw(env: Env): Promise<SkillInfo[]> {
  const rows = await all<SkillRow>(
    env.DB,
    "SELECT id, title, caption, description, goal, library, hidden, auto FROM skills ORDER BY created",
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: SkillInfo[] = [];
  for (const s of SKILLS) {
    const row = byId.get(s.id);
    if (row?.hidden) continue;
    out.push(row ? rowToInfo(row, true) : builtInInfo(s));
  }
  for (const r of rows) if (!r.hidden && !SKILLS.some((s) => s.id === r.id)) out.push(rowToInfo(r, false));
  return out;
}

/** The skill definition the prompt builder runs for an id; hidden or unknown ids fall back to the editorial skill. */
export async function resolveSkill(env: Env, id: string | undefined): Promise<SkillDef> {
  const row = id
    ? await first<SkillRow>(
        env.DB,
        "SELECT id, title, caption, description, goal, library, hidden, auto FROM skills WHERE id = ?",
        id,
      )
    : null;
  if (row && !row.hidden) return deriveSkill(row);
  const builtIn = SKILLS.find((s) => s.id === id && !row?.hidden);
  if (builtIn) return builtIn;
  // Unknown or hidden id: the first skill the team still has, else the editorial text as a last resort.
  const fallback = (await listSkills(env))[0];
  if (!fallback) return SKILLS[0];
  return fallback.builtIn && !fallback.edited
    ? (SKILLS.find((s) => s.id === fallback.id) ?? SKILLS[0])
    : deriveSkill(fallback);
}
