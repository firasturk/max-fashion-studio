import { describe, expect, it } from "vitest";
import {
  deliveryKey,
  driveFolderId,
  guessSkill,
  importName,
  isDeliveryName,
  learnRule,
} from "../shared/drive";

describe("drive links", () => {
  it("reads the folder id from the usual link shapes", () => {
    expect(driveFolderId("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp?usp=sharing")).toBe("1AbCdEfGhIjKlMnOp");
    expect(driveFolderId("https://drive.google.com/drive/u/0/folders/1AbCdEfGhIjKlMnOp")).toBe("1AbCdEfGhIjKlMnOp");
    expect(driveFolderId("https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp")).toBe("1AbCdEfGhIjKlMnOp");
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
