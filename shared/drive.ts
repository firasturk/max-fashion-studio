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
