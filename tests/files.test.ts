import { describe, expect, it } from "vitest";
import { collapseContainer, folderCount, isCampaignShot } from "../shared/paths";

describe("collapseContainer", () => {
  it("drops a container folder that only holds product folders", () => {
    const r = collapseContainer([
      "Men options/169178472/a.jpg",
      "Men options/169178472/b.jpg",
      "Men options/169318734/a.jpg",
    ]);
    expect(r.root).toBe("Men options");
    expect(r.paths).toEqual(["169178472/a.jpg", "169178472/b.jpg", "169318734/a.jpg"]);
  });
  it("keeps a single product folder as picked", () => {
    const r = collapseContainer(["169178472/a.jpg", "169178472/b.jpg"]);
    expect(r.root).toBeNull();
    expect(r.paths).toEqual(["169178472/a.jpg", "169178472/b.jpg"]);
  });
  it("keeps the folder when it has files of its own", () => {
    const r = collapseContainer(["Shoot/cover.jpg", "Shoot/a/1.jpg", "Shoot/b/1.jpg"]);
    expect(r.root).toBeNull();
  });
  it("counts distinct top-level folders", () => {
    expect(folderCount(["a/1.jpg", "a/2.jpg", "b/1.jpg", "loose.jpg"])).toBe(2);
  });
  it("keeps a product folder that has only one nested subfolder", () => {
    const r = collapseContainer(["169178472/front/1.jpg", "169178472/front/2.jpg"]);
    expect(r.root).toBeNull();
  });
});

describe("isCampaignShot", () => {
  it("keeps the first two shots in every numbering style", () => {
    for (const n of [
      "a/169178472_01.jpg",
      "169178472_02.JPG",
      "x_1.png",
      "x_2.webp",
      "x_001.jpg",
      "x_002.jpeg",
    ])
      expect(isCampaignShot(n)).toBe(true);
  });
  it("drops later shots and unnumbered files", () => {
    for (const n of [
      "a/169178472_03.jpg",
      "x_10.jpg",
      "x_012.jpg",
      "x_21.jpg",
      "label.jpg",
      "x-01.jpg",
    ])
      expect(isCampaignShot(n)).toBe(false);
  });
});
