import { describe, expect, it } from "vitest";
import { walkInbox, type DriveFile, type DriveFolderRow } from "../server/drive";

const FOLDER = "application/vnd.google-apps.folder";
type Tree = { [name: string]: Tree | string[] };

/** A pretend Drive: folders are objects, a list of strings is the files inside a folder. */
function drive(tree: Tree, stamp = "2026-11-01T00:00:00Z") {
  const files: DriveFile[] = [];
  const add = (node: Tree | string[], parent: string, path: string) => {
    if (Array.isArray(node)) {
      for (const name of node)
        files.push({
          id: `${path}/${name}`,
          name,
          mimeType: /\.(jpe?g|png)$/i.test(name) ? "image/jpeg" : "application/octet-stream",
          parents: [parent],
          modifiedTime: stamp,
        });
      return;
    }
    for (const [name, inner] of Object.entries(node)) {
      const id = `${path}/${name}`;
      // An empty list under a name with an extension is a loose file beside the folders.
      if (Array.isArray(inner) && !inner.length && /^\.|\.\w+$/.test(name)) {
        files.push({
          id,
          name,
          mimeType: "application/octet-stream",
          parents: [parent],
          modifiedTime: stamp,
        });
        continue;
      }
      files.push({ id, name, mimeType: FOLDER, parents: [parent], modifiedTime: stamp });
      add(inner, id, id);
    }
  };
  add(tree, "root", "");
  let calls = 0;
  return {
    files,
    get calls() {
      return calls;
    },
    list: async (parents: string[]) => {
      calls++;
      return files.filter((f) => f.parents?.some((p) => parents.includes(p)));
    },
  };
}

const product = (id: string) => [
  `${id}_01.jpg`,
  `${id}_02.jpg`,
  `${id}_03.jpg`,
  `${id}_07_tag.jpg`,
];
const products = (...ids: string[]) => Object.fromEntries(ids.map((id) => [id, product(id)]));

const NOVEMBER: Tree = {
  November: {
    "27-11-2026-466": {
      "27-11-2026-MW-78": {
        "27-11-2026-MW URBN-6": products("170374972", "170469681", "170372976"),
        "27-11-2026-MW Active-6": products("170111111", "170222222"),
      },
      "27-11-2026-WW-246": {
        "27-11-2026-WW Basic-12": products("170333333"),
      },
      ".DS_Store": [],
    },
    "27-11-2026-466.zip": [],
    "Party Edit": { "Party looks": Array.from({ length: 40 }, (_, i) => `look${i}.jpg`) },
    "13-11-26 MAX Footwear AI": {
      "Sneaker white": ["a.jpg", "b.jpg"],
      "Sandal tan": ["a.jpg", "b.jpg", "c.jpg"],
    },
    "Men Alpine Club Collection": products("170444444", "170555555"),
  },
  October: {},
};

async function settle(
  d: ReturnType<typeof drive>,
  rows: DriveFolderRow[] = [],
  maxCalls = 24,
  at = Date.now(),
) {
  const known = await walkInbox(
    "root",
    rows,
    d.list,
    () => {},
    async () => {},
    maxCalls,
    () => at,
  );
  return [...known.values()];
}
const waiting = (rows: DriveFolderRow[]) =>
  rows
    .filter((r) => r.state === "waiting")
    .map((r) => `${r.path} / ${r.name} [${r.products}p ${r.files}f]`)
    .sort();

describe("reading the client's Drive", () => {
  it("finds the folders that become batches, wherever they sit in the tree", async () => {
    const rows = await settle(drive(NOVEMBER));
    expect(waiting(rows)).toEqual([
      "November / 13-11-26 MAX Footwear AI [2p 0f]",
      "November / 27-11-2026-466 / 27-11-2026-MW-78 / 27-11-2026-MW Active-6 [2p 0f]",
      "November / 27-11-2026-466 / 27-11-2026-MW-78 / 27-11-2026-MW URBN-6 [3p 0f]",
      "November / 27-11-2026-466 / 27-11-2026-WW-246 / 27-11-2026-WW Basic-12 [1p 0f]",
      "November / Men Alpine Club Collection [2p 0f]",
      "November / Party Edit / Party looks [0p 40f]",
    ]);
    // Months, daily drops and departments are remembered but never offered.
    expect(
      rows
        .filter((r) => r.state === "group")
        .map((r) => r.name)
        .sort(),
    ).toEqual([
      "27-11-2026-466",
      "27-11-2026-MW-78",
      "27-11-2026-WW-246",
      "November",
      "October",
      "Party Edit",
    ]);
    // No product folder is ever recorded as something to approve.
    expect(rows.some((r) => /^\d{6,}$/.test(r.name) || r.name === "Sneaker white")).toBe(false);
  });

  it("carries a big first read over to the next check", async () => {
    const d = drive(NOVEMBER);
    let rows = await settle(d, [], 3);
    expect(waiting(rows).length).toBeLessThan(6);
    for (let i = 0; i < 6; i++) rows = await settle(d, rows, 3);
    expect(waiting(rows)).toHaveLength(6);
  });

  it("costs one request when nothing changed, and notices a new drop", async () => {
    const d = drive(NOVEMBER, "2026-01-01T00:00:00Z");
    let rows = await settle(d);
    const before = d.calls;
    rows = await settle(d, rows);
    expect(d.calls - before).toBe(1);

    // Drive does not touch the month's own date when a drop lands inside it.
    const fresh = drive(
      { November: { "28-11-2026-12": { "28-11-2026-BOYS-12": products("170666666") } } },
      new Date().toISOString(),
    );
    d.files.push(...fresh.files.filter((f) => f.id !== "/November"));
    rows = await settle(d, rows);
    expect(waiting(rows)).toHaveLength(6);
    const later = Date.now() + 6 * 60_000;
    for (let i = 0; i < 4; i++) rows = await settle(d, rows, 24, later + i * 6 * 60_000);
    expect(waiting(rows)).toContain("November / 28-11-2026-12 / 28-11-2026-BOYS-12 [1p 0f]");
    expect(waiting(rows)).toHaveLength(7);
  });

  it("lets go of a waiting folder that was taken off Drive, but keeps finished work", async () => {
    const d = drive(NOVEMBER, "2026-01-01T00:00:00Z");
    let rows = await settle(d);
    const done = rows.find((r) => r.name === "27-11-2026-MW Active-6")!;
    done.state = "imported";
    const cut = (id: string) => {
      for (let i = d.files.length - 1; i >= 0; i--)
        if (d.files[i].id === id || d.files[i].id.startsWith(`${id}/`)) d.files.splice(i, 1);
    };
    cut("/November/27-11-2026-466");
    rows = await settle(d, rows, 24, Date.now() + 6 * 60_000);
    expect(rows.find((r) => r.name === "27-11-2026-MW URBN-6")?.state).toBe("gone");
    expect(rows.find((r) => r.name === "27-11-2026-MW Active-6")?.state).toBe("imported");
    expect(rows.some((r) => r.name === "27-11-2026-466")).toBe(false);
  });
});
