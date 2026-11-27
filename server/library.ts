/**
 * The Pinterest library. The studio gathers pictures from a short list of public boards (fashion
 * editorials and campaigns, to start with) and accounts; people pick the ones they like into a skill, or hide them. Gathering only reads
 * Pinterest's public feed, so it takes seconds and costs nothing; no skill is made here.
 */
import type { Env } from "./env";
import { errorMessage, StudioError } from "./errors";
import { all, first, now, run, uuid } from "./db";
import { getSetting, setSetting } from "./settings";
import { accountBoards, decodeEntities, downloadPins, pinterestPins } from "./pinterest";
import { askVision, buildSkillFromReferences } from "./skillbuilder";
import {
  STARTER_SOURCES,
  boardShelf,
  isOffTopicBoard,
  isShopBoard,
  parsePinterestLink,
  type Pin,
} from "@shared/pinterest";

const SOURCES_SETTING = "pinterest_sources";
const RUN_SETTING = "library_last_run";
/** How many of an account's boards are read in full on one pass. */
const BOARDS_PER_ACCOUNT = 6;
/** How many pictures of one board are taken on one pass. */
const PINS_PER_BOARD = 30;

export interface LibraryPin {
  id: string;
  account: string;
  board: string;
  thumb: string;
  note: string;
}

export async function librarySources(env: Env): Promise<string[]> {
  const raw = await getSetting(env, SOURCES_SETTING);
  if (raw === null) return STARTER_SOURCES;
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return STARTER_SOURCES;
  }
}

/** Saves the accounts and boards to gather from. Every line must be a Pinterest account or board. */
export async function setLibrarySources(env: Env, links: string[]): Promise<string[]> {
  const clean: string[] = [];
  for (const raw of links
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 30)) {
    const t = parsePinterestLink(raw);
    if (!t || t.kind === "pin" || t.kind === "short")
      throw new StudioError(`Not a Pinterest account or board link: ${raw.slice(0, 80)}`);
    const link =
      t.kind === "user"
        ? `https://www.pinterest.com/${t.user}/`
        : `https://www.pinterest.com/${t.user}/${t.board}/`;
    if (!clean.includes(link)) clean.push(link);
  }
  await setSetting(env, SOURCES_SETTING, JSON.stringify(clean));
  await setSetting(env, RUN_SETTING, "0");
  return clean;
}

/** A board the team listed by name is taken whole; boards found on an account are judged by name. */
async function keep(env: Env, account: string, pins: Pin[], chosen = false): Promise<number> {
  let added = 0;
  for (const p of pins) {
    if (!chosen && (isShopBoard(p.board, p.boardUrl) || isOffTopicBoard(p.board))) continue;
    added += await run(
      env.DB,
      `INSERT OR IGNORE INTO pin_library (id, account, board, thumb, image, note, twin, state, seen)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?)`,
      p.id,
      account,
      decodeEntities(p.board),
      p.thumb,
      p.image,
      decodeEntities(p.note),
      p.twin,
      now(),
    );
  }
  return added;
}

/**
 * One account or board. For an account, the boards on its public profile are read (a shop's
 * newest pins are mostly its product feed, so the boards are where the campaigns are), leaving
 * out the ones whose name says they are about something else.
 */
async function gather(env: Env, link: string): Promise<number> {
  const target = parsePinterestLink(link);
  const source = await pinterestPins(link).catch(() => null);
  const title = decodeEntities(source?.title ?? (target?.kind === "user" ? target.user : link));
  const chosen = target?.kind === "board";
  // A listed board goes on the shelf its name says (Kids, Activewear, ...); an account keeps its name.
  const account = chosen ? boardShelf(title) : title;
  let added = source
    ? await keep(
        env,
        account,
        source.pins.slice(0, PINS_PER_BOARD * 2).map((p) => (chosen ? { ...p, board: title } : p)),
        chosen,
      )
    : 0;
  if (target?.kind !== "user") return added;
  const fromFeed = (source?.pins ?? []).filter((p) => p.boardUrl).map((p) => p.boardUrl);
  const fromProfile = await accountBoards(target.user).catch(() => [] as string[]);
  const boards = [...new Set([...fromProfile, ...fromFeed])]
    .filter((url) => {
      const slug = decodeURIComponent(url.split("/").filter(Boolean)[1] ?? "");
      return !isShopBoard(slug.replace(/-/g, " "), url) && !isOffTopicBoard(slug);
    })
    .slice(0, BOARDS_PER_ACCOUNT);
  for (const url of boards) {
    try {
      const board = await pinterestPins(`https://www.pinterest.com${url}`);
      added += await keep(
        env,
        account,
        board.pins
          .slice(0, PINS_PER_BOARD)
          .map((p) => ({ ...p, board: p.board || board.title, boardUrl: p.boardUrl || url })),
      );
    } catch (e) {
      console.log("[library] board", url, errorMessage(e));
    }
  }
  return added;
}

/** Asks for a gathering on the schedule's next turn, within a minute. Returns at once. */
export async function askForGathering(env: Env): Promise<void> {
  await setSetting(env, RUN_SETTING, "0");
}

/**
 * Gathers new pictures from every watched account, side by side. Runs a few times a day from the
 * schedule, or at once when someone asks.
 */
export async function refreshLibrary(env: Env, force = false): Promise<number> {
  const last = Number((await getSetting(env, RUN_SETTING)) ?? 0);
  if (!force && now() - last < 6 * 60 * 60_000) return 0;
  await setSetting(env, RUN_SETTING, String(now()));
  const results = await Promise.all(
    (await librarySources(env)).map((link) =>
      gather(env, link).catch((e) => {
        console.log("[library] source", link, errorMessage(e));
        return 0;
      }),
    ),
  );
  const added = results.reduce((a, b) => a + b, 0);
  console.log("[library] gathered", added, "new pictures");
  return added;
}

export async function listLibrary(
  env: Env,
  account: string | null,
  board: string | null,
  offset: number,
  limit: number,
): Promise<{
  pins: LibraryPin[];
  total: number;
  accounts: { account: string; n: number }[];
  boards: { board: string; n: number }[];
  /** Pictures gathered but not looked at yet; they appear once they pass. */
  checking: number;
}> {
  const where = ["state = 'new'", "usable = 1"];
  const args: string[] = [];
  if (account) {
    where.push("account = ?");
    args.push(account);
    if (board) {
      where.push("board = ?");
      args.push(board);
    }
  }
  const pins = await all<LibraryPin>(
    env.DB,
    `SELECT id, account, board, thumb, note FROM pin_library WHERE ${where.join(" AND ")} ORDER BY seen DESC, id DESC LIMIT ? OFFSET ?`,
    ...args,
    limit,
    offset,
  );
  const total = await first<{ n: number }>(
    env.DB,
    `SELECT COUNT(*) AS n FROM pin_library WHERE ${where.join(" AND ")}`,
    ...args,
  );
  const accounts = await all<{ account: string; n: number }>(
    env.DB,
    "SELECT account, COUNT(*) AS n FROM pin_library WHERE state = 'new' AND usable = 1 GROUP BY account ORDER BY n DESC",
  );
  const boards = account
    ? await all<{ board: string; n: number }>(
        env.DB,
        "SELECT board, COUNT(*) AS n FROM pin_library WHERE state = 'new' AND usable = 1 AND account = ? GROUP BY board ORDER BY n DESC",
        account,
      )
    : [];
  const checking = await first<{ n: number }>(
    env.DB,
    "SELECT COUNT(*) AS n FROM pin_library WHERE state = 'new' AND usable IS NULL",
  );
  return { pins, total: total?.n ?? 0, accounts, boards, checking: checking?.n ?? 0 };
}

/** Takes pictures off the library: hidden by a person, or used in a skill. */
export async function markPins(env: Env, ids: string[], state: "hidden" | "used"): Promise<void> {
  for (let i = 0; i < ids.length; i += 40) {
    const group = ids.slice(i, i + 40);
    await run(
      env.DB,
      `UPDATE pin_library SET state = ? WHERE id IN (${group.map(() => "?").join(",")})`,
      state,
      ...group,
    );
  }
}

/* ---------------------------------------------------------------------------------------------
   Background work: every gathered picture is looked at once, and complete skills are prepared
   from the good ones so that approving one is instant.
   --------------------------------------------------------------------------------------------- */

const BUSY_SETTING = "library_busy";
/** How many prepared skills may wait for a decision at once. */
const READY_LIMIT = 8;
const DRAFT_MIN = 6;
const DRAFT_MAX = 16;

const LOOK_SCHEMA = {
  type: "object",
  properties: {
    pictures: {
      type: "array",
      items: {
        type: "object",
        properties: {
          n: { type: "integer" },
          model: { type: "boolean" },
          body: { type: "boolean" },
          text: { type: "boolean" },
          child: { type: "boolean" },
          editorial: { type: "boolean" },
          covered: { type: "boolean" },
        },
        required: ["n", "model", "body", "text", "child", "editorial", "covered"],
      },
    },
  },
  required: ["pictures"],
};

function lookInstruction(count: number): string {
  return [
    `${count} numbered pictures are attached, in order (1 to ${count}). A fashion studio wants to know which can serve as references for background, pose and light. Judge every picture on its own and answer six yes/no questions for each.`,
    "model: true only when it is a real photograph in which exactly one fashion model, of any age, is the subject. False when two or more people share the frame, and for empty rooms, shops, buildings, objects, food, products on their own, flat lays, illustrations, screenshots, collages and split frames.",
    "body: true only when most of the model's body is in view (at least from the knees or the waist up to the head). False for close-ups of a face, eyes, hands, feet or a detail of a garment.",
    "text: true when any words, prices, percentages, logos or graphic shapes are printed over the picture, anywhere. A sign that is physically part of the scene does not count.",
    "child: true when a person in the picture looks under 16.",
    "editorial: true only when it looks like a professionally made fashion editorial or campaign photograph: the model is posed on purpose, the light and the composition are considered, and the place was chosen for the picture. False for candid street snapshots, paparazzi, red-carpet and event photos, selfies and mirror photos, phone snapshots, influencer outfit posts, and catalogue cut-outs on a blank white background.",
    "covered: true only when the person is fully dressed in day clothes or sportswear. False for underwear, lingerie, swimwear, nightwear, a bare torso or a see-through garment.",
    "Return ONLY a JSON object: { pictures: [ { n, model, body, text, child, editorial, covered }, ... ] } with one entry per picture.",
  ].join("\n\n");
}

interface Look {
  n: number;
  model: boolean;
  body: boolean;
  text: boolean;
  child: boolean;
  editorial: boolean;
  covered: boolean;
}
type Photo = Awaited<ReturnType<typeof downloadPins>>[number];

/**
 * Whether a picture goes into the library. Everywhere it must be an editorial of one model, most
 * of the body in view, nothing printed over it. A child is kept only on the Kids shelf and only
 * fully dressed in day clothes; every other shelf is adults only.
 */
export function isUsable(look: Omit<Look, "n">, board: string): boolean {
  if (!look.model || !look.body || !look.editorial || look.text) return false;
  if (boardShelf(board) === "Kids") {
    // A board that mixes children with underwear or swimwear is never a source.
    if (/lingerie|underwear|intimate|swim|bikini/i.test(board)) return false;
    return look.child && look.covered;
  }
  return !look.child;
}

/**
 * Asks about a pile of pictures. When the whole pile is refused or the answer cannot be read, the
 * pile is asked again in halves, so one picture the model will not look at costs only itself.
 */
async function lookAt(env: Env, photos: Photo[]): Promise<Map<Photo, Look>> {
  const found = new Map<Photo, Look>();
  if (!photos.length) return found;
  try {
    const answer = JSON.parse(
      await askVision(env, lookInstruction(photos.length), photos, LOOK_SCHEMA),
    ) as { pictures?: Look[] };
    for (const p of answer.pictures ?? []) if (photos[p.n - 1]) found.set(photos[p.n - 1], p);
  } catch (e) {
    if (photos.length === 1) {
      console.log("[library] not looked at", photos[0].name, errorMessage(e));
      return found;
    }
    const half = Math.ceil(photos.length / 2);
    for (const part of await Promise.all([
      lookAt(env, photos.slice(0, half)),
      lookAt(env, photos.slice(half)),
    ]))
      for (const [photo, look] of part) found.set(photo, look);
  }
  return found;
}

/** Looks at the next few pictures nobody has checked yet. Returns how many it looked at. */
export async function checkPins(env: Env, batch = 12): Promise<number> {
  const rows = await all<{ id: string; thumb: string; board: string }>(
    env.DB,
    "SELECT id, thumb, board FROM pin_library WHERE state = 'new' AND usable IS NULL ORDER BY seen DESC, id DESC LIMIT ?",
    batch,
  );
  if (!rows.length) return 0;
  const photos = await downloadPins(
    rows.map((r) => ({ id: r.id, image: r.thumb })),
    "236x",
  ).catch(() => []);
  const boards = new Map(rows.map((r) => [r.id, r.board]));
  const good = new Set<string>();
  for (const [photo, look] of await lookAt(env, photos)) {
    const id = /pinterest-(\d+)\./.exec(photo.name)?.[1] ?? "";
    if (boards.has(id) && isUsable(look, boards.get(id) ?? "")) good.add(id);
  }
  // A picture that could not be fetched or was not answered for is left out, not asked again.
  for (const r of rows)
    await run(
      env.DB,
      "UPDATE pin_library SET usable = ? WHERE id = ?",
      good.has(r.id) ? 1 : 0,
      r.id,
    );
  return rows.length;
}

const NAME_SCHEMA = {
  type: "object",
  properties: {
    keep: { type: "array", items: { type: "integer" } },
    name: { type: "string" },
    tagline: { type: "string" },
  },
  required: ["keep", "name", "tagline"],
};

function nameInstruction(count: number): string {
  return [
    `${count} numbered fashion photographs are attached, in order (1 to ${count}). They will become the reference photos of one "skill": a look a studio can shoot again and again.`,
    "keep: the numbers of the photographs that belong together as one look (the same kind of place, light and mood). Leave out the odd ones. Never keep two photographs that are the same picture.",
    "name: 2 to 4 words in plain catalogue English for that look, the way a stylist would file it (for example 'Quiet tailoring', 'Winter street', 'Sunlit resort'). No brand names, no years.",
    "tagline: 3 to 6 words naming the place and the light, separated by commas or a middle dot (for example 'Stone courtyards · overcast light').",
    "Return ONLY a JSON object with keys keep, name and tagline.",
  ].join("\n\n");
}

/**
 * Prepares one complete skill from a board that has enough good pictures: chooses the ones that
 * belong together, names the look, stores the photos and writes the skill's text from them. The
 * result waits as a ready skill; approving it only switches it on.
 */
export async function prepareSkill(env: Env): Promise<string | null> {
  const waiting = await first<{ n: number }>(
    env.DB,
    "SELECT COUNT(*) AS n FROM skill_drafts WHERE state = 'waiting'",
  );
  if ((waiting?.n ?? 0) >= READY_LIMIT) return null;
  const group = await first<{ account: string; board: string }>(
    env.DB,
    `SELECT account, board FROM pin_library WHERE state = 'new' AND usable = 1
       AND NOT EXISTS (
         SELECT 1 FROM pin_library u
         WHERE u.account = pin_library.account AND u.board = pin_library.board
           AND u.state = 'new' AND u.usable IS NULL)
     GROUP BY account, board HAVING COUNT(*) >= ? ORDER BY COUNT(*) DESC LIMIT 1`,
    DRAFT_MIN + 2,
  );
  if (!group) return null;
  const pins = await all<{ id: string; thumb: string; image: string }>(
    env.DB,
    "SELECT id, thumb, image FROM pin_library WHERE state = 'new' AND usable = 1 AND account = ? AND board = ? ORDER BY seen DESC, id DESC LIMIT ?",
    group.account,
    group.board,
    DRAFT_MAX,
  );
  // Whatever happens next, these pictures have had their turn.
  await markPins(
    env,
    pins.map((p) => p.id),
    "used",
  );
  const thumbs = await downloadPins(
    pins.map((p) => ({ id: p.id, image: p.thumb })),
    "236x",
  );
  const order = thumbs.map((ph) => /pinterest-(\d+)\./.exec(ph.name)?.[1] ?? "");
  const named = JSON.parse(
    await askVision(env, nameInstruction(thumbs.length), thumbs, NAME_SCHEMA),
  ) as { keep?: number[]; name?: string; tagline?: string };
  const kept = [...new Set(named.keep ?? [])]
    .map((n) => pins.find((p) => p.id === order[n - 1]))
    .filter((p): p is (typeof pins)[number] => !!p);
  if (kept.length < DRAFT_MIN) return null;
  const title = (named.name ?? "").trim().slice(0, 40) || group.board.slice(0, 40);
  const taken =
    (await first(env.DB, "SELECT id FROM skills WHERE lower(title) = lower(?)", title)) ||
    (await first(
      env.DB,
      "SELECT id FROM skill_drafts WHERE lower(title) = lower(?) AND state = 'waiting'",
      title,
    ));
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 30) || "look";
  const id = `${base}-${uuid().slice(0, 4)}`;
  const photos = await downloadPins(kept);
  const built = await buildSkillFromReferences(
    env,
    title,
    photos.slice(0, 10).map((p) => ({ bytes: p.bytes, mime: p.mime })),
  );
  const t = now();
  for (const [i, p] of photos.entries()) {
    const ref = uuid();
    const key = `refs/${id}/${ref}`;
    await env.BUCKET.put(key, p.bytes, { httpMetadata: { contentType: p.mime } });
    await run(
      env.DB,
      "INSERT INTO refs (id, skill, key, name, framing, notes, created) VALUES (?, ?, ?, ?, NULL, NULL, ?)",
      ref,
      id,
      key,
      p.name,
      t + i,
    );
  }
  await run(
    env.DB,
    `INSERT INTO skill_drafts (id, origin, title, caption, description, goal, library, photos, state, created, updated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'waiting', ?, ?)`,
    id,
    `${group.account} · ${group.board}`.slice(0, 120),
    taken ? `${title} ${photos.length}` : title,
    (named.tagline ?? "").trim().slice(0, 80),
    built.description,
    built.goal,
    built.library,
    photos.length,
    t,
    t,
  );
  console.log("[library] ready skill:", title, "with", photos.length, "photos from", group.account);
  return id;
}

/**
 * One turn of background work, started by the schedule every minute: gather when it is time,
 * look at a few unchecked pictures, and prepare a skill when a board has enough good ones. Only
 * one turn runs at a time.
 */
export async function libraryWork(env: Env): Promise<void> {
  const busy = Number((await getSetting(env, BUSY_SETTING)) ?? 0);
  if (now() - busy < 4 * 60_000) return;
  await setSetting(env, BUSY_SETTING, String(now()));
  try {
    await refreshLibrary(env);
    for (let i = 0; i < 3; i++) if (!(await checkPins(env, 16))) break;
    // A skill is prepared as soon as one board has been looked at in full.
    await prepareSkill(env).catch((e) => console.error("[library] prepare", errorMessage(e)));
  } finally {
    await setSetting(env, BUSY_SETTING, "0");
  }
}

export interface ReadySkill {
  id: string;
  origin: string;
  title: string;
  caption: string;
  description: string;
  photos: string[];
}

export async function listReady(env: Env): Promise<ReadySkill[]> {
  const rows = await all<Omit<ReadySkill, "photos">>(
    env.DB,
    "SELECT id, origin, title, caption, description FROM skill_drafts WHERE state = 'waiting' ORDER BY created DESC LIMIT 20",
  );
  const out: ReadySkill[] = [];
  for (const r of rows) {
    const refs = await all<{ id: string }>(
      env.DB,
      "SELECT id FROM refs WHERE skill = ? ORDER BY created",
      r.id,
    );
    out.push({ ...r, photos: refs.map((x) => x.id) });
  }
  return out;
}

/** Switches a prepared skill on. Its photos and text are already in place, so this is instant. */
export async function approveReady(env: Env, id: string, title?: string): Promise<string> {
  const d = await first<{
    id: string;
    title: string;
    caption: string;
    description: string;
    goal: string;
    library: string;
  }>(env.DB, "SELECT * FROM skill_drafts WHERE id = ? AND state = 'waiting'", id);
  if (!d) throw new StudioError("That skill is no longer waiting.", 404);
  const t = now();
  await run(
    env.DB,
    `INSERT INTO skills (id, title, caption, description, goal, library, hidden, auto, created, updated)
     VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?)`,
    d.id,
    title?.trim() || d.title,
    d.caption,
    d.description,
    d.goal,
    d.library,
    t,
    t,
  );
  await run(env.DB, "UPDATE skill_drafts SET state = 'approved', updated = ? WHERE id = ?", t, id);
  return d.id;
}

/** Throws a prepared skill away, with the photos stored for it. */
export async function dismissReady(env: Env, id: string): Promise<void> {
  const d = await first(
    env.DB,
    "SELECT id FROM skill_drafts WHERE id = ? AND state = 'waiting'",
    id,
  );
  if (!d) return;
  const refs = await all<{ id: string; key: string }>(
    env.DB,
    "SELECT id, key FROM refs WHERE skill = ?",
    id,
  );
  if (refs.length) await env.BUCKET.delete(refs.map((r) => r.key));
  await run(env.DB, "DELETE FROM refs WHERE skill = ?", id);
  await run(
    env.DB,
    "UPDATE skill_drafts SET state = 'dismissed', updated = ? WHERE id = ?",
    now(),
    id,
  );
}
