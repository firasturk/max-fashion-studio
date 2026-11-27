/** Pure helpers for the Drive inbox: folder links, delivery names, and the folder-to-skill memory. */

/** The folder id inside a Drive link (or the id itself). */
export function driveFolderId(link: string): string | null {
  const s = link.trim();
  const m = /\/folders\/([A-Za-z0-9_-]{10,})/.exec(s) ?? /[?&]id=([A-Za-z0-9_-]{10,})/.exec(s);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{10,}$/.test(s) ? s : null;
}

/** Deliveries are named date first: "28-10-2026-WW Denim-14". Other folders are categories. */
export function isDeliveryName(name: string): boolean {
  return /^\s*\d{1,2}[-./]\d{1,2}[-./]\d{2,4}(?!\d)/.test(name);
}

/** What a delivery is about, without its date and photo count: "28-10-2026-WW Denim-14" is "ww denim". */
export function deliveryKey(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/^\d{1,2}[-./]\d{1,2}[-./]\d{2,4}/, "")
    .replace(/[-_\s]+\d+\s*$/, "")
    .replace(/^[-_\s]+|[-_\s]+$/g, "")
    .replace(/\s+/g, " ");
}

/** For every delivery key, how many times each skill was chosen. */
export type DriveRules = Record<string, Record<string, number>>;

export interface SkillGuess {
  skill: string | null;
  /** high: the same kind of folder ran on this skill before; low: a related folder did; none: never seen. */
  confidence: "high" | "low" | "none";
  why: string;
  /** Skills worth offering first, best first. */
  options: string[];
}

function ranked(counts: Record<string, number>): [string, number][] {
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

/** Which skill a new delivery most likely wants, from what the team chose for folders like it. */
export function guessSkill(name: string, rules: DriveRules): SkillGuess {
  const key = deliveryKey(name);
  const exact = key ? rules[key] : undefined;
  if (exact) {
    const list = ranked(exact);
    const total = list.reduce((n, [, c]) => n + c, 0);
    const [skill, count] = list[0];
    if (count / total >= 0.6)
      return {
        skill,
        confidence: "high",
        why: `${count} of the last ${total} "${key}" folders ran on this skill.`,
        options: list.map(([s]) => s),
      };
    return {
      skill,
      confidence: "low",
      why: `"${key}" folders were split between skills. Choose one and the studio remembers it.`,
      options: list.map(([s]) => s),
    };
  }
  const head = key.split(" ")[0];
  const related: Record<string, number> = {};
  if (head)
    for (const [k, counts] of Object.entries(rules))
      if (k.split(" ")[0] === head)
        for (const [s, c] of Object.entries(counts)) related[s] = (related[s] ?? 0) + c;
  const list = ranked(related);
  if (list.length)
    return {
      skill: list[0][0],
      confidence: "low",
      why: `No "${key}" folder ran before. Other "${head}" folders used this skill most.`,
      options: list.map(([s]) => s),
    };
  return {
    skill: null,
    confidence: "none",
    why: "The studio has not seen a folder like this. Choose a skill and it remembers it.",
    options: [],
  };
}

/** Records the skill chosen for a delivery, so the next folder like it is suggested correctly. */
export function learnRule(rules: DriveRules, name: string, skill: string): DriveRules {
  const key = deliveryKey(name);
  if (!key) return rules;
  const counts = { ...(rules[key] ?? {}) };
  counts[skill] = (counts[skill] ?? 0) + 1;
  return { ...rules, [key]: counts };
}

/** The path a Drive photo gets inside its batch: delivery name, then its folders, then the file. */
export function importName(delivery: string, relative: string): string {
  return `${delivery.trim()}/${relative}`.replace(/\/{2,}/g, "/").normalize("NFC");
}

/** Product folders are named with the product number alone: "170374972". */
export function isProductName(name: string): boolean {
  return /^\s*\d{6,}(?!\d)/.test(name) && !isDeliveryName(name);
}

const FOLDER_TYPE = "application/vnd.google-apps.folder";

/** What a folder under the inbox is, judged from what sits directly inside it. */
export type FolderKind =
  /** Holds product folders (or loose photos): the unit that becomes one batch. */
  | { kind: "delivery"; products: number; photos: number }
  /** Holds other folders: a month, a day's drop, a department. */
  | { kind: "group" }
  /** A handful of photos and nothing else: one product, so its parent is the delivery. */
  | { kind: "product"; photos: number }
  | { kind: "empty" };

export function classifyFolder(
  name: string,
  children: { name: string; mimeType: string }[],
): FolderKind {
  const folders = children.filter((c) => c.mimeType === FOLDER_TYPE);
  const photos = children.filter((c) => c.mimeType.startsWith("image/")).length;
  const products = folders.filter((f) => isProductName(f.name)).length;
  if (products > 0 && products >= folders.length - products)
    return { kind: "delivery", products, photos: 0 };
  if (folders.length) return { kind: "group" };
  if (!photos) return { kind: "empty" };
  return photos <= 20 && !isDeliveryName(name)
    ? { kind: "product", photos }
    : { kind: "delivery", products: 0, photos };
}

/** The view number of a product photo: "170374972_02.jpg" is 2. Null when the name has none. */
export function viewNumber(file: string): number | null {
  const m = /[_\s-]0*(\d{1,2})(?:_[a-z]+)?\.[a-z0-9]+$/i.exec(file);
  return m ? Number(m[1]) : null;
}

/** Label and tag close-ups come with every product and are never a picture to generate from. */
export function isTagPhoto(file: string): boolean {
  return /[_\s-](tag|label|care)\.[a-z0-9]+$/i.test(file);
}

/**
 * The photos of a delivery that get generated: for every product, its first two views (front and
 * back), which is what the team has always uploaded and what goes back to the client. A product
 * whose photos are not numbered keeps all of them. Tag photos are always left out.
 */
export function pickProductPhotos<T extends { relative: string }>(photos: T[], views = 2): T[] {
  const byProduct = new Map<string, T[]>();
  for (const p of photos) {
    const cut = p.relative.lastIndexOf("/");
    const folder = cut < 0 ? "" : p.relative.slice(0, cut);
    byProduct.set(folder, [...(byProduct.get(folder) ?? []), p]);
  }
  const out: T[] = [];
  for (const [folder, list] of byProduct) {
    const usable = list.filter((p) => !isTagPhoto(p.relative));
    const numbered = usable.filter((p) => viewNumber(p.relative) !== null);
    // Loose photos straight in the delivery are each their own picture.
    if (!folder || numbered.length < usable.length) {
      out.push(...usable);
      continue;
    }
    out.push(
      ...numbered
        .sort((a, b) => (viewNumber(a.relative) ?? 0) - (viewNumber(b.relative) ?? 0))
        .slice(0, views),
    );
  }
  return out;
}

/**
 * A person's choices for a delivery before it is approved, by Drive photo id: a skill id gives
 * the photo that skill, "*" generates it with the folder's skill, "" leaves it out. A photo
 * without a choice follows the usual rule (the first two views of its product).
 */
export type FolderPlan = Record<string, string>;

/** The photos that will be generated, each with its own skill or null for the folder's. */
export function plannedPhotos<T extends { id: string; relative: string }>(
  photos: T[],
  plan: FolderPlan = {},
): { photo: T; skill: string | null }[] {
  const usual = new Set(pickProductPhotos(photos).map((p) => p.id));
  const out: { photo: T; skill: string | null }[] = [];
  for (const photo of photos) {
    const choice = plan[photo.id];
    if (choice === "") continue;
    if (choice === undefined && !usual.has(photo.id)) continue;
    out.push({ photo, skill: choice && choice !== "*" ? choice : null });
  }
  return out;
}

/** Keeps only the choices that differ from the usual rule, so a plan stays small. */
export function tidyPlan<T extends { id: string; relative: string }>(
  photos: T[],
  plan: FolderPlan,
): FolderPlan {
  const usual = new Set(pickProductPhotos(photos).map((p) => p.id));
  const known = new Set(photos.map((p) => p.id));
  const out: FolderPlan = {};
  for (const [id, choice] of Object.entries(plan)) {
    if (!known.has(id)) continue;
    if (choice === "*" && usual.has(id)) continue;
    if (choice === "" && !usual.has(id)) continue;
    out[id] = choice;
  }
  return out;
}
