import { describe, expect, it } from "vitest";
import { colourHex, colourLabel } from "../shared/colours";
import { solidPng, hexToRgb } from "../shared/png";

describe("backdrop colours", () => {
  it("knows the common names and keeps typed hex codes", () => {
    expect(colourHex("warm beige")).toBe("#E8D3B3");
    expect(colourHex("Pure White")).toBe("#FFFFFF");
    expect(colourHex("light grey seamless backdrop")).toBe("#D9D9D9");
    expect(colourHex("#f2e8da")).toBe("#F2E8DA");
    expect(colourHex("dusty rose")).toBeNull();
  });
  it("labels a name with its hex and leaves unknown names alone", () => {
    expect(colourLabel("warm beige")).toBe("warm beige (#E8D3B3)");
    expect(colourLabel("#F2E8DA")).toBe("#F2E8DA");
    expect(colourLabel("dusty rose")).toBe("dusty rose");
  });
  it("writes a valid solid PNG", async () => {
    const png = await solidPng("#E8D3B3", 16);
    expect(Array.from(png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(new TextDecoder().decode(png.slice(12, 16))).toBe("IHDR");
    // width and height
    expect(png[19]).toBe(16);
    expect(png[23]).toBe(16);
    expect(new TextDecoder().decode(png.slice(png.length - 8, png.length - 4))).toBe("IEND");
    expect(hexToRgb("#E8D3B3")).toEqual([232, 211, 179]);
  });
});
