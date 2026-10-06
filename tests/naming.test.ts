import { describe, expect, it } from "vitest";
import {
  isValidSourceName,
  numberOutputs,
  outputExt,
  outputName,
  productId,
  shotNumber,
  safeArchiveName,
  stemKey,
  stemOf,
} from "../shared/naming";

describe("naming", () => {
  it("names results ProductID_0_N with the engine's format", () => {
    expect(outputName("168761402_01.jpg", 1)).toBe("168761402_0_1.png");
    expect(outputName("168761402_02.JPEG", 2)).toBe("168761402_0_2.png");
    expect(outputName("168761402_02.jpg", 2, "jpg")).toBe("168761402_0_2.jpg");
  });
  it("never doubles the suffix when a previous result is re-uploaded", () => {
    expect(outputName("168761402_0_1.png", 1)).toBe("168761402_0_1.png");
    expect(outputName("MAX_001-AI.png", 1)).toBe("MAX_001_0_1.png");
    expect(productId("168761402_0_12.png")).toBe("168761402");
  });
  it("keeps folder paths and case in the product id", () => {
    expect(outputName("Denim/169800580_01.jpg", 3)).toBe("Denim/169800580_0_3.png");
    expect(productId("Denim.v2/MAX_001.jpg")).toBe("Denim.v2/MAX_001");
    expect(productId("Denim/Abc-2.jpg")).toBe("Denim/Abc");
    expect(isValidSourceName("Denim/MAX_001.jpg")).toBe(true);
    expect(isValidSourceName("Denim//MAX_001.jpg")).toBe(false);
    expect(isValidSourceName("../MAX_001.jpg")).toBe(false);
  });
  it("reads the trailing shot number", () => {
    expect(shotNumber("169800580_02.jpg")).toBe(2);
    expect(shotNumber("Denim/169800580_001.jpg")).toBe(0);
    expect(shotNumber("MAX-3.png")).toBe(3);
    expect(shotNumber("look (12).jpg")).toBe(12);
    expect(shotNumber("169800580.jpg")).toBe(0);
  });
  it("numbers the images of one product together, by upload name then card", () => {
    const items = [
      { name: "A/168761402_02.jpg", card: 1 },
      { name: "A/168761402_01.jpg", card: 2 },
      { name: "A/168761402_01.jpg", card: 1 },
      { name: "B/555_01.jpg", card: 1 },
    ];
    const n = numberOutputs(
      items,
      (i) => i.name,
      (i) => i.card,
    );
    expect(n.get(items[2])).toBe(1);
    expect(n.get(items[1])).toBe(2);
    expect(n.get(items[0])).toBe(3);
    expect(n.get(items[3])).toBe(1);
  });
  it("keeps unicode stems", () => {
    expect(outputName("فستان_٠١.webp", 1)).toBe("فستان_٠١_0_1.png");
    expect(stemOf("فستان_٠١.webp")).toBe("فستان_٠١");
  });
  it("treats different extensions and cases as the same output", () => {
    expect(stemKey("MAX_001.jpg")).toBe(stemKey("max_001.PNG"));
    expect(stemKey("MAX_001-ai.png")).toBe(stemKey("MAX_001.jpg"));
  });
  it("rejects path separators and control characters", () => {
    expect(isValidSourceName("a\\b.jpg")).toBe(false);
    expect(isValidSourceName("bad\u0000.jpg")).toBe(false);
    expect(isValidSourceName("MAX 001.jpg")).toBe(true);
    expect(isValidSourceName("")).toBe(false);
  });
  it("keeps the engine's real format in the export name", () => {
    expect(outputExt("u/b/output/t/abc.jpg")).toBe("jpg");
    expect(outputExt(null)).toBe("png");
    expect(outputName("MAX_001.jpg", 1, "jpg")).toBe("MAX_001_0_1.jpg");
  });
  it("makes safe archive names", () => {
    expect(safeArchiveName("Denim · 30/09/2026")).toBe("Denim_30_09_2026");
    expect(safeArchiveName("")).toBe("batch");
  });
});

describe("product sets", () => {
  it("groups files that share an id with a trailing counter", async () => {
    const { productKey } = await import("../shared/naming");
    expect(productKey("169800580_01.jpg")).toBe("169800580");
    expect(productKey("169800580_02.JPG")).toBe("169800580");
    expect(productKey("Dresses/169800580-3.png")).toBe("dresses/169800580");
    expect(productKey("MAX_001 (2).jpg")).toBe("max_001");
    expect(productKey("MAX_001-AI.png")).toBe("max_001");
    expect(productKey("MAX_001_02.png")).toBe("max_001");
    expect(productKey("blue-shirt.jpg")).toBe("blue-shirt");
  });
});
