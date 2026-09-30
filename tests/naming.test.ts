import { describe, expect, it } from "vitest";
import { isValidSourceName, outputName, safeArchiveName, stemKey, stemOf } from "../shared/naming";

describe("naming", () => {
  it("adds -AI and switches the extension to png", () => {
    expect(outputName("MAX_001.jpg", 1, "4")).toBe("MAX_001-AI.png");
    expect(outputName("MAX_001.JPEG", 1, "2")).toBe("MAX_001-AI.png");
  });
  it("never doubles the suffix when a previous result is re-uploaded", () => {
    expect(outputName("MAX_001-AI.png", 1, "4")).toBe("MAX_001-AI.png");
  });
  it("keeps folder paths and numbers multi-image sets", () => {
    expect(outputName("Denim/MAX_001.jpg", 2, "4", 3)).toBe("Denim/MAX_001-AI-02.png");
    expect(outputName("Denim.v2/MAX_001.jpg", 1, "4")).toBe("Denim.v2/MAX_001-AI.png");
    expect(isValidSourceName("Denim/MAX_001.jpg")).toBe(true);
    expect(isValidSourceName("Denim//MAX_001.jpg")).toBe(false);
    expect(isValidSourceName("../MAX_001.jpg")).toBe(false);
  });
  it("uses card folders for six-card sets", () => {
    expect(outputName("MAX_001.jpg", 1, "1")).toBe("MAX_001/card-01/MAX_001-AI.png");
    expect(outputName("MAX_001.jpg", 6, "1")).toBe("MAX_001/card-06/MAX_001-AI.png");
  });
  it("keeps unicode stems", () => {
    expect(outputName("فستان_٠١.webp", 1, "4")).toBe("فستان_٠١-AI.png");
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
  it("makes safe archive names", () => {
    expect(safeArchiveName("Denim · 30/09/2026")).toBe("Denim_30_09_2026");
    expect(safeArchiveName("")).toBe("batch");
  });
});
