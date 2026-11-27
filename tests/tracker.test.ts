import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { readXlsx } from "../shared/xlsx";
import {
  readTracker,
  sheetDate,
  tabMonth,
  trackerIndex,
  trackerKey,
  trackerMatch,
} from "../shared/tracker";

/** A small .xlsx built by hand: the same parts Google Sheets exports, deflated or stored. */
function xlsx(sheets: { name: string; rows: (string | number)[][] }[], deflate = true): Uint8Array {
  const strings: string[] = [];
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const col = (i: number) => String.fromCharCode(65 + i);
  const files: [string, string][] = [];
  sheets.forEach((s, n) => {
    const rows = s.rows
      .map((r, y) => {
        const cells = r
          .map((v, x) => {
            if (v === "") return `<c r="${col(x)}${y + 1}" s="1"/>`;
            if (typeof v === "number") return `<c r="${col(x)}${y + 1}"><v>${v}</v></c>`;
            let at = strings.indexOf(v);
            if (at < 0) at = strings.push(v) - 1;
            return `<c r="${col(x)}${y + 1}" t="s"><v>${at}</v></c>`;
          })
          .join("");
        return `<row r="${y + 1}">${cells}</row>`;
      })
      .join("");
    files.push([
      `xl/worksheets/sheet${n + 1}.xml`,
      `<worksheet><sheetData>${rows}</sheetData></worksheet>`,
    ]);
  });
  files.push([
    "xl/workbook.xml",
    `<workbook><sheets>${sheets.map((s, n) => `<sheet name="${esc(s.name)}" sheetId="${n + 1}" r:id="rId${n + 1}"/>`).join("")}</sheets></workbook>`,
  ]);
  files.push([
    "xl/_rels/workbook.xml.rels",
    `<Relationships>${sheets.map((_, n) => `<Relationship Id="rId${n + 1}" Type="x" Target="worksheets/sheet${n + 1}.xml"/>`).join("")}</Relationships>`,
  ]);
  files.push([
    "xl/sharedStrings.xml",
    `<sst>${strings.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join("")}</sst>`,
  ]);
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of files) {
    const raw = enc.encode(text);
    const data = deflate ? new Uint8Array(deflateRawSync(raw)) : raw;
    const nm = enc.encode(name);
    const local = new Uint8Array(30 + nm.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, deflate ? 8 : 0, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nm.length, true);
    local.set(nm, 30);
    const cd = new Uint8Array(46 + nm.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, deflate ? 8 : 0, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, nm.length, true);
    cv.setUint32(42, offset, true);
    cd.set(nm, 46);
    parts.push(local, data);
    central.push(cd);
    offset += local.length + data.length;
  }
  const size = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, size, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const BOOK = [
  {
    name: "AI-Tracker-Nov-2026",
    rows: [
      [
        "Column 1",
        "Completed",
        "# of Folders Shared",
        "Status",
        "Date Recived",
        "Date of Sahring",
        "Note",
        "Assigned to",
      ],
      ["22-10-2026-WW URBN-22", 22, 22, "Completed", 46317, 46346, "", "someone@example.com"],
      ["27-11-2026-WW-246", "", 246, "", 46354, "", "", "someone@example.com"],
      ["Party Edit", 91, 91, "Completed", 46342, 46343, "Party & Edit <new>", ""],
      ["", 113, 359, "", "", "", "", ""],
    ],
  },
  {
    name: "AI-Tracker June & July",
    rows: [
      ["", "Folder Name"],
      ["", "old folder", 5, 5, "Completed"],
    ],
  },
  {
    name: "Publishing Status",
    rows: [
      ["Column 1", "Folders name", "Status"],
      [
        "25Nov/ReadyToPublish",
        "22-10-2026-WW URBN-22\n22-10-2026-WW Basic-12",
        "Published by Content",
      ],
    ],
  },
];

describe("reading a spreadsheet file", () => {
  it("reads cell text from deflated and stored files alike", async () => {
    for (const deflate of [true, false]) {
      const sheets = await readXlsx(xlsx(BOOK, deflate));
      expect(sheets.map((s) => s.name)).toEqual(BOOK.map((s) => s.name));
      expect(sheets[0].rows[1].slice(0, 6)).toEqual([
        "22-10-2026-WW URBN-22",
        "22",
        "22",
        "Completed",
        "46317",
        "46346",
      ]);
      expect(sheets[0].rows[2][1]).toBe("");
      expect(sheets[0].rows[3][6]).toBe("Party & Edit <new>");
    }
  });
  it("only opens the tabs it is asked for", async () => {
    const sheets = await readXlsx(xlsx(BOOK), (n) => /publishing/i.test(n));
    expect(sheets.map((s) => s.name)).toEqual(["Publishing Status"]);
  });
});

describe("the tracker", () => {
  it("reads month tabs and dates", () => {
    expect(tabMonth("AI-Tracker-Nov-2026")).toBe("2026-11");
    expect(tabMonth("AI-Tracker-March-2026")).toBe("2026-03");
    expect(tabMonth("AI-Tracker-June")).toBeNull();
    expect(tabMonth("Publishing Status")).toBeNull();
    expect(sheetDate("46308")).toBe("2026-10-13");
    expect(sheetDate("")).toBe("");
    expect(trackerKey("22-10-2026-MW Casual_16")).toBe(trackerKey("22 10 2026 mw  casual-16"));
  });
  it("knows what was delivered, what is still open and what was uploaded", async () => {
    const rows = readTracker(await readXlsx(xlsx(BOOK)));
    expect(rows.map((r) => [r.name, r.delivered, r.done, r.shared])).toEqual([
      ["22-10-2026-WW URBN-22", true, 22, 22],
      ["27-11-2026-WW-246", false, 0, 246],
      ["Party Edit", true, 91, 91],
    ]);
    expect(rows[0]).toMatchObject({
      month: "2026-11",
      received: "2026-10-22",
      sent: "2026-11-20",
      upload: "25Nov/ReadyToPublish",
      published: "Published by Content",
    });
    expect(rows[1]).toMatchObject({ sent: "", upload: "" });
    // Nobody's address is carried over.
    expect(JSON.stringify(rows)).not.toContain("example.com");
  });
  it("matches a Drive folder by its own name or the department it sits in", async () => {
    const index = trackerIndex(readTracker(await readXlsx(xlsx(BOOK))));
    expect(
      trackerMatch(index, "22-10-2026-WW URBN-22", "October / 22-10-2026-300")?.delivered,
    ).toBe(true);
    expect(
      trackerMatch(
        index,
        "27-11-2026-WW Lingerie-62",
        "November / 27-11-2026-466 / 27-11-2026-WW-246",
      )?.delivered,
    ).toBe(false);
    expect(trackerMatch(index, "06.11.26 Max", "November")).toBeNull();
  });
});
