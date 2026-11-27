import { describe, expect, it } from "vitest";
import {
  classifyFolder,
  isProductName,
  pickProductPhotos,
  viewNumber,
  deliveryKey,
  driveFolderId,
  guessSkill,
  importName,
  isDeliveryName,
  learnRule,
} from "../shared/drive";

describe("drive links", () => {
  it("reads the folder id from the usual link shapes", () => {
    expect(
      driveFolderId("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp?usp=sharing"),
    ).toBe("1AbCdEfGhIjKlMnOp");
    expect(driveFolderId("https://drive.google.com/drive/u/0/folders/1AbCdEfGhIjKlMnOp")).toBe(
      "1AbCdEfGhIjKlMnOp",
    );
    expect(driveFolderId("https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp")).toBe(
      "1AbCdEfGhIjKlMnOp",
    );
    expect(driveFolderId(" 1AbCdEfGhIjKlMnOp ")).toBe("1AbCdEfGhIjKlMnOp");
    expect(driveFolderId("https://example.com/nothing")).toBeNull();
  });
});

describe("delivery names", () => {
  it("tells deliveries from category folders", () => {
    expect(isDeliveryName("28-10-2026-WW Denim-14")).toBe(true);
    expect(isDeliveryName(" 12-10-2026-5-6 girls-51")).toBe(true);
    expect(isDeliveryName("Women")).toBe(false);
    expect(isDeliveryName("170023817")).toBe(false);
  });
  it("reduces a delivery to what it is about", () => {
    expect(deliveryKey("28-10-2026-WW Denim-14")).toBe("ww denim");
    expect(deliveryKey("28-06-2026-BOYS-76")).toBe("boys");
    expect(deliveryKey("12-10-2026-5-6 girls-51")).toBe("5-6 girls");
    expect(deliveryKey("28-06-2026-WW-180")).toBe("ww");
  });
  it("names an imported photo by delivery and its own folders", () => {
    expect(importName(" 28-10-2026-WW Denim-14", "170206643/170206643_02.jpg")).toBe(
      "28-10-2026-WW Denim-14/170206643/170206643_02.jpg",
    );
  });
});

describe("skill memory", () => {
  it("is confident after the same kind of folder ran on one skill", () => {
    let rules = learnRule({}, "01-11-2026-WW Denim-20", "women-urban");
    rules = learnRule(rules, "08-11-2026-WW Denim-12", "women-urban");
    const g = guessSkill("28-10-2026-WW Denim-14", rules);
    expect(g.skill).toBe("women-urban");
    expect(g.confidence).toBe("high");
  });
  it("offers a related skill with low confidence, and none for a new kind", () => {
    const rules = learnRule({}, "01-11-2026-WW Denim-20", "women-urban");
    const related = guessSkill("03-11-2026-WW Lingerie-9", rules);
    expect(related.confidence).toBe("low");
    expect(related.skill).toBe("women-urban");
    expect(guessSkill("03-11-2026-BOYS-9", rules).confidence).toBe("none");
  });
  it("asks when a kind of folder was split between skills", () => {
    let rules = learnRule({}, "01-11-2026-BOYS-20", "kids");
    rules = learnRule(rules, "02-11-2026-BOYS-20", "street-style");
    const g = guessSkill("03-11-2026-BOYS-9", rules);
    expect(g.confidence).toBe("low");
    expect(g.options.sort()).toEqual(["kids", "street-style"]);
  });
});

describe("the client's Drive layout", () => {
  const folder = (name: string) => ({ name, mimeType: "application/vnd.google-apps.folder" });
  const photo = (name: string) => ({ name, mimeType: "image/jpeg" });
  it("knows a product folder by its number", () => {
    expect(isProductName("170374972")).toBe(true);
    expect(isProductName(" 170374972 ")).toBe(true);
    expect(isProductName("27-11-2026-MW URBN-6")).toBe(false);
    expect(isProductName("November")).toBe(false);
  });
  it("tells months, daily drops and departments from the folder that becomes a batch", () => {
    expect(classifyFolder("November", [folder("27-11-2026-466"), folder("Party Edit")]).kind).toBe(
      "group",
    );
    expect(
      classifyFolder("27-11-2026-466", [
        folder("27-11-2026-MW-78"),
        folder("27-11-2026-WW-246"),
        { name: ".DS_Store", mimeType: "application/octet-stream" },
      ]).kind,
    ).toBe("group");
    expect(classifyFolder("27-11-2026-MW-78", [folder("27-11-2026-MW URBN-6")]).kind).toBe("group");
    expect(
      classifyFolder("27-11-2026-MW URBN-6", [folder("170374972"), folder("170469681")]),
    ).toEqual({ kind: "delivery", products: 2, photos: 0 });
    expect(
      classifyFolder("170374972", [photo("170374972_01.jpg"), photo("170374972_02.jpg")]),
    ).toEqual({
      kind: "product",
      photos: 2,
    });
    expect(
      classifyFolder(
        "Party Edit",
        Array.from({ length: 40 }, (_, i) => photo(`p${i}.jpg`)),
      ),
    ).toEqual({
      kind: "delivery",
      products: 0,
      photos: 40,
    });
    expect(
      classifyFolder("27-11-2026-zip only", [{ name: "a.zip", mimeType: "application/zip" }]).kind,
    ).toBe("empty");
  });
  it("reads the view number of a product photo", () => {
    expect(viewNumber("170374972_02.jpg")).toBe(2);
    expect(viewNumber("170173353 _01.jpg")).toBe(1);
    expect(viewNumber("170374972_07_tag.jpg")).toBe(7);
    expect(viewNumber("IMG-photo.jpeg")).toBeNull();
  });
  it("generates from the first two views of every product and never from the tag", () => {
    const all = [
      "170374972/170374972_06.jpg",
      "170374972/170374972_04.jpg",
      "170374972/170374972_07_tag.jpg",
      "170374972/170374972_02.jpg",
      "170374972/170374972_01.jpg",
      "170469681/170469681_01.jpg",
      "170469681/170469681_02_tag.jpg",
      "Looks/front.jpg",
      "Looks/side.jpg",
      "loose_05.jpg",
    ].map((relative) => ({ relative }));
    expect(pickProductPhotos(all).map((p) => p.relative)).toEqual([
      "170374972/170374972_01.jpg",
      "170374972/170374972_02.jpg",
      "170469681/170469681_01.jpg",
      "Looks/front.jpg",
      "Looks/side.jpg",
      "loose_05.jpg",
    ]);
  });
});
