/** The label colour of a skill: the same skill always wears the same colour, on every page. */
const TONES = ["pink", "sky", "violet", "orange", "green", "teal"] as const;

export function skillTone(id: string | null | undefined): string {
  let h = 0;
  for (const ch of id ?? "") h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `nx-tag nx-${TONES[h % TONES.length]}`;
}
