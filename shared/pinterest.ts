/** Reading Pinterest links and its public board feed. Shared by the Worker and the tests. */

export type PinterestTarget =
  | { kind: "board"; user: string; board: string }
  | { kind: "pin"; id: string }
  | { kind: "user"; user: string }
  | { kind: "short"; url: string };

/** First path segments that are Pinterest's own pages, not a person's boards. */
const RESERVED = new Set([
  "pin",
  "search",
  "ideas",
  "today",
  "explore",
  "business",
  "settings",
  "login",
  "signup",
  "_",
]);

export function parsePinterestLink(link: string): PinterestTarget | null {
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(link.trim()) ? link.trim() : `https://${link.trim()}`);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (host === "pin.it") return u.pathname.length > 1 ? { kind: "short", url: u.toString() } : null;
  if (!/(^|\.)pinterest\.[a-z.]{2,6}$/.test(host)) return null;
  const parts = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "pin" && parts[1]) {
    const id = /(\d{6,})$/.exec(parts[1])?.[1];
    return id ? { kind: "pin", id } : null;
  }
  if (!parts.length || RESERVED.has(parts[0].toLowerCase())) return null;
  // An account's own page ("/name/", "/name/_saved/") stands for all its public pins.
  if (parts.length === 1 || parts[1].startsWith("_")) return { kind: "user", user: parts[0] };
  return { kind: "board", user: parts[0], board: parts[1] };
}

export interface Pin {
  id: string;
  /** A small picture for the chooser. */
  thumb: string;
  /** The picture kept as a reference photo. */
  image: string;
  note: string;
  /** The board the pin sits on, when the feed says so. */
  board: string;
  /** That board's own page ("/account/board/"), to read more of it. */
  boardUrl: string;
  /** The same for every pin of one picture, so a picture saved twice is kept once. */
  twin: string;
}

const PINIMG =
  /^https:\/\/i\.pinimg\.com\/(\d+x|originals)\/([0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]+\.(?:jpe?g|png|webp))$/i;

/** Only pictures on Pinterest's own image host are ever fetched. */
export function pinImage(url: string, size: "236x" | "736x"): string | null {
  const m = PINIMG.exec(url);
  return m ? `https://i.pinimg.com/${size}/${m[2]}` : null;
}

interface RawPin {
  board?: { name?: unknown; url?: unknown };
  dominant_color?: unknown;
  id?: unknown;
  is_video?: unknown;
  description?: unknown;
  images?: Record<string, { url?: unknown } | undefined>;
}

/** The still pictures in an answer from Pinterest's public feed, in the board's own order. */
export function readPins(raw: unknown): Pin[] {
  const out: Pin[] = [];
  const seen = new Set<string>();
  for (const p of (Array.isArray(raw) ? raw : []) as RawPin[]) {
    const id = typeof p?.id === "string" ? p.id : "";
    const first = Object.values(p?.images ?? {}).find((i) => typeof i?.url === "string") as
      { url: string; width?: unknown; height?: unknown } | undefined;
    const url = first?.url;
    const thumb = url ? pinImage(url, "236x") : null;
    const image = url ? pinImage(url, "736x") : null;
    if (!id || !thumb || !image || p.is_video === true || seen.has(image)) continue;
    seen.add(image);
    out.push({
      id,
      thumb,
      image,
      note: typeof p.description === "string" ? p.description.trim().slice(0, 140) : "",
      board: typeof p.board?.name === "string" ? p.board.name.trim().slice(0, 60) : "",
      boardUrl: typeof p.board?.url === "string" ? p.board.url : "",
      // Pinterest files a picture under its own content: the same picture pinned twice has one path.
      twin: image,
    });
  }
  return out;
}

/**
 * Boards that are not mood boards: the product feed a shop publishes ("/shop/_products/") and
 * boards of adverts. Their pictures are packshots and sale banners, useless as references.
 */
export function isShopBoard(name: string, url: string): boolean {
  const slug = url.split("/").filter(Boolean)[1] ?? "";
  return (
    slug.startsWith("_") ||
    /publicit|promot|advert|sponsor|\bads?\b|\bsale\b|^products?$/i.test(name.trim())
  );
}

/**
 * Boards whose name says they are not about people wearing clothes in a place: homeware, beauty,
 * gifts, shoes and bags on their own, shop interiors, events, magazine covers, celebrity news,
 * children. Skipping them by name saves looking at every picture in them.
 */
export function isOffTopicBoard(name: string): boolean {
  return /home|decor|interior|beaut|make-?up|skin|hair|nail|fragrance|perfume|gift|food|recipe|store|shop|accessor|jewel|bag|shoe|heel|sneaker|footwear|kids|baby|school|event|party|cover|celebrit|award|film|\btv\b|culture|music|wedding|mariage|meme|quote|art\b/i.test(
    name.replace(/[-_]+/g, " "),
  );
}

/** The board pages an account shows on its public profile, as "/account/board/" paths. */
export function profileBoards(html: string, user: string): string[] {
  const safe = user.replace(/[^a-zA-Z0-9_-]/g, "");
  const found = html.match(new RegExp(`"url":"/${safe}/[^"/]{1,80}/"`, "g")) ?? [];
  return [...new Set(found.map((m) => m.slice(7, -1)))].filter(
    (url) => !url.split("/")[2].startsWith("_"),
  );
}

/**
 * What the library gathers from until the team chooses its own: public boards that people curate
 * around fashion editorials and campaigns. (Brand accounts were tried first: they mostly repost
 * their followers' snapshots, which are no use as references.)
 */
export const STARTER_SOURCES = [
  // Women's editorials and campaigns
  "https://www.pinterest.com/anneclairerohe/campaigns-editorial/",
  "https://www.pinterest.com/simaoa/editorial-fashion-photography/",
  "https://www.pinterest.com/lefashion/editorials/",
  "https://www.pinterest.com/johannacaryhi/fashion-editorial-photography/",
  "https://www.pinterest.com/stwildcatchick/editorial-fashion-photography/",
  "https://www.pinterest.com/reneabean/fashion-editorials/",
  "https://www.pinterest.com/behnazbaba/editorial-photography/",
  "https://www.pinterest.com/callmeyenna/editorial/",
  "https://www.pinterest.com/lakoco/campaign-shoots/",
  "https://www.pinterest.com/levtproductions/fashion-advertising-photography-on-location/",
  "https://www.pinterest.com/mvillasenor/editorial-location-set/",
  "https://www.pinterest.com/magdotj/location-photo-shoots/",
  "https://www.pinterest.com/mattpaxton750/full-body-street/",
  "https://www.pinterest.com/straightastyle/street-style-fashion/",
  // Kids
  "https://www.pinterest.com/kidsfashionphotography/kids-fashion-campaign/",
  "https://www.pinterest.com/samiamphoto/children-editorials/",
  "https://www.pinterest.com/ddrice1992/kids-editorial/",
  "https://www.pinterest.com/meganbreukelman/fashion-editorial-kids/",
  "https://www.pinterest.com/sohostoryphoto/kids-commercial/",
  "https://www.pinterest.com/jmejme/children-fashion-editorial/",
  // Lingerie, sleepwear and loungewear
  "https://www.pinterest.com/everydayfolly/lingerie-editorial-style/",
  "https://www.pinterest.com/mawuenam/lingerie-shoot-ideas/",
  "https://www.pinterest.com/seanmdo/lingerie-editorial/",
  "https://www.pinterest.com/irispan927/sleepwear-editorial/",
  "https://www.pinterest.com/geritorresphoto/loungewear-shoot/",
  // Activewear
  "https://www.pinterest.com/asandaphoto/editorial-sportswear/",
  "https://www.pinterest.com/abowserphoto/athletic-shoots/",
  "https://www.pinterest.com/mjd82/activewear-photoshoot/",
  // Menswear
  "https://www.pinterest.com/eggelhoffer/mens-fashion-editorial-photography/",
  "https://www.pinterest.com/michaelasays/mens-fashion-editorial/",
  "https://www.pinterest.com/brittbendabout/mens-editorial-shoot/",
  "https://www.pinterest.com/alexandrafolster/mens-editorial/",
  // Modest wear
  "https://www.pinterest.com/thestylist_bosaina/hijab-editorial/",
  "https://www.pinterest.com/eimgmt/muslim-model-mood-board-inspiration/",
  "https://www.pinterest.com/mfpristantyo/hijab-editorial/",
];

export const LIBRARY_SHELVES = [
  "Kids",
  "Lingerie & sleepwear",
  "Activewear",
  "Modest wear",
  "Menswear",
  "Editorial",
] as const;
export type LibraryShelf = (typeof LIBRARY_SHELVES)[number];

/**
 * The shelf a board's pictures go on, read from the board's name. Kids come first on purpose:
 * a board about children is always treated as one, whatever else its name says.
 */
export function boardShelf(name: string): LibraryShelf {
  const n = name.replace(/[-_]+/g, " ");
  if (/\b(kids?|child(ren)?s?|junior|toddlers?|bab(y|ies)|teens?)\b/i.test(n)) return "Kids";
  if (
    /lingerie|intimates?\b|underwear|sleepwear|nightwear|loungewear|lounge wear|pyjama|pajama/i.test(
      n,
    )
  )
    return "Lingerie & sleepwear";
  if (/active ?wear|sports? ?wear|athlet|athleisure|fitness|\bgym\b|\byoga\b/i.test(n))
    return "Activewear";
  if (/hijab|modest|muslim|abaya/i.test(n)) return "Modest wear";
  if (/\bmen(['\u2019]?s)?\b|menswear|\bmale\b/i.test(n)) return "Menswear";
  return "Editorial";
}
