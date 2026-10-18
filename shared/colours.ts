/** Named backdrop colours the team types in the Backdrop colour approach, with a definite hex. */
const NAMED: Record<string, string> = {
  white: "#FFFFFF",
  "pure white": "#FFFFFF",
  "off white": "#F4F1EC",
  "off-white": "#F4F1EC",
  cream: "#F5EBDC",
  ivory: "#F7F2E6",
  beige: "#E6D5B8",
  "warm beige": "#E8D3B3",
  "light beige": "#EFE3CF",
  sand: "#E2CDA5",
  taupe: "#B9A99A",
  "light grey": "#D9D9D9",
  "light gray": "#D9D9D9",
  grey: "#A9A9A9",
  gray: "#A9A9A9",
  "mid grey": "#8C8C8C",
  "dark grey": "#4A4A4A",
  charcoal: "#3C3C3C",
  black: "#0A0A0A",
  blush: "#F2D4D7",
  "light pink": "#F6DDE2",
  pink: "#EFB7C3",
  peach: "#F5CBA7",
  "sky blue": "#CFE3F2",
  "light blue": "#D6E6F2",
  blue: "#5B86C5",
  navy: "#1F2A44",
  mint: "#D6EFE3",
  sage: "#C9D3C0",
  olive: "#8A8F5C",
  green: "#6FA36B",
  lavender: "#DCD3EC",
  lilac: "#D8C8E8",
  purple: "#7D5BA6",
  mustard: "#D9A93A",
  yellow: "#F2D04F",
  orange: "#E8893A",
  terracotta: "#C9754F",
  brown: "#7B5A3C",
  red: "#B8322E",
  burgundy: "#6E1E2B",
};

const HEX = /#?([0-9a-f]{6})\b/i;

/** The hex of a typed colour: a hex code as written, or the table's value for a known name. */
export function colourHex(text: string): string | null {
  const m = HEX.exec(text);
  if (m) return `#${m[1].toUpperCase()}`;
  const key = text
    .toLowerCase()
    .replace(/\b(seamless|backdrop|background|paper|studio|solid|flat)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return NAMED[key] ?? null;
}

/** How the colour is written in a prompt: the name with its hex when one is known. */
export function colourLabel(text: string): string {
  const hex = colourHex(text);
  if (!hex) return text;
  return HEX.test(text) ? text : `${text} (${hex})`;
}
