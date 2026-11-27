/**
 * Just enough of the .xlsx format to read cell text out of a spreadsheet exported by Google
 * Sheets: the ZIP directory, inflate, shared strings and sheet rows. Read only, no styles.
 */

interface ZipEntry {
  method: number;
  packed: number;
  offset: number;
}

const u16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u32 = (b: Uint8Array, i: number) =>
  (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

/** The files inside a ZIP, by name, from its central directory. */
function zipDirectory(b: Uint8Array): Map<string, ZipEntry> {
  let end = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 66_000); i--)
    if (u32(b, i) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw new Error("Not a spreadsheet file.");
  const count = u16(b, end + 10);
  let at = u32(b, end + 16);
  const names = new TextDecoder();
  const out = new Map<string, ZipEntry>();
  for (let n = 0; n < count && u32(b, at) === 0x02014b50; n++) {
    const nameLen = u16(b, at + 28);
    out.set(names.decode(b.subarray(at + 46, at + 46 + nameLen)), {
      method: u16(b, at + 10),
      packed: u32(b, at + 20),
      offset: u32(b, at + 42),
    });
    at += 46 + nameLen + u16(b, at + 30) + u16(b, at + 32);
  }
  return out;
}

async function zipText(b: Uint8Array, e: ZipEntry): Promise<string> {
  const start = e.offset + 30 + u16(b, e.offset + 26) + u16(b, e.offset + 28);
  const packed = b.subarray(start, start + e.packed);
  if (e.method === 0) return new TextDecoder().decode(packed);
  if (e.method !== 8)
    throw new Error("This spreadsheet is packed in a way the studio cannot read.");
  // A copy with its own buffer: a view over the whole file is not a Blob part in every runtime.
  const stream = new Blob([packed.slice().buffer])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

const textOf = (xml: string) =>
  [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1])).join("");

function column(ref: string): number {
  let n = 0;
  for (const ch of /^[A-Z]+/.exec(ref)?.[0] ?? "A") n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

export interface Sheet {
  name: string;
  /** Rows that hold anything, each as the text of its cells from column A on. */
  rows: string[][];
}

/**
 * Reads the sheets whose name passes `want` (all of them when left out). Numbers and dates come
 * back as the number Sheets stores, as text.
 */
export async function readXlsx(
  bytes: ArrayBuffer | Uint8Array,
  want: (name: string) => boolean = () => true,
  maxColumns = 12,
): Promise<Sheet[]> {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dir = zipDirectory(b);
  const file = async (name: string) => {
    const e = dir.get(name);
    return e ? zipText(b, e) : "";
  };
  const strings = [...(await file("xl/sharedStrings.xml")).matchAll(/<si>([\s\S]*?)<\/si>/g)].map(
    (m) => textOf(m[1]),
  );
  const targets = new Map(
    [...(await file("xl/_rels/workbook.xml.rels")).matchAll(/<Relationship\b[^>]*>/g)].map((m) => [
      /\bId="([^"]+)"/.exec(m[0])?.[1] ?? "",
      /\bTarget="([^"]+)"/.exec(m[0])?.[1] ?? "",
    ]),
  );
  const out: Sheet[] = [];
  for (const m of (await file("xl/workbook.xml")).matchAll(/<sheet\b[^>]*>/g)) {
    const name = unescapeXml(/\bname="([^"]*)"/.exec(m[0])?.[1] ?? "");
    const target = targets.get(/\br:id="([^"]+)"/.exec(m[0])?.[1] ?? "") ?? "";
    if (!target || !want(name)) continue;
    const xml = await file(`xl/${target.replace(/^\/?(xl\/)?/, "")}`);
    const rows: string[][] = [];
    for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const at = column(/\br="([A-Z]+)\d+"/.exec(c[1])?.[1] ?? "A");
        if (at >= maxColumns) continue;
        const type = /\bt="([^"]+)"/.exec(c[1])?.[1];
        const v = /<v>([\s\S]*?)<\/v>/.exec(c[2] ?? "")?.[1] ?? "";
        const value =
          type === "s"
            ? (strings[Number(v)] ?? "")
            : type === "inlineStr"
              ? textOf(c[2] ?? "")
              : unescapeXml(v);
        cells[at] = value.trim();
      }
      const filled = Array.from({ length: cells.length }, (_, i) => cells[i] ?? "");
      if (filled.some(Boolean)) rows.push(filled);
    }
    out.push({ name, rows });
  }
  return out;
}
