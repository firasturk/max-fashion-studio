import { describe, expect, it } from "vitest";
import { deltaE, findOffColour, readBorder, rgbToLab } from "../shared/backdrop";

function solid(
  w: number,
  h: number,
  rgb: [number, number, number],
  centre?: [number, number, number],
) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const inner = centre && x > w * 0.2 && x < w * 0.8 && y > h * 0.2 && y < h * 0.8;
      const c = inner ? centre! : rgb;
      const i = (y * w + x) * 4;
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
      data[i + 3] = 255;
    }
  return data;
}

const BEIGE: [number, number, number] = [228, 206, 176];
const GREY: [number, number, number] = [204, 204, 208];
const PINK: [number, number, number] = [240, 170, 190];

describe("backdrop colour check", () => {
  it("reads the border colour and ignores the product in the middle", () => {
    const read = readBorder(solid(40, 40, BEIGE, PINK), 40, 40);
    expect(deltaE(read.colour, rgbToLab(...BEIGE))).toBeLessThan(1);
    expect(read.agreement).toBeGreaterThan(0.95);
  });

  it("flags the grey result in a beige group and nothing else", () => {
    const beige = readBorder(solid(40, 40, BEIGE, PINK), 40, 40);
    const grey = readBorder(solid(40, 40, GREY, PINK), 40, 40);
    const off = findOffColour([
      { id: "a", group: 1, read: beige },
      { id: "b", group: 1, read: beige },
      { id: "c", group: 1, read: grey },
      { id: "d", group: 1, read: beige },
    ]);
    expect(off).toEqual(["c"]);
  });

  it("skips images whose edges are mostly product", () => {
    const covered = readBorder(solid(40, 40, PINK, PINK), 40, 40);
    const beige = readBorder(solid(40, 40, BEIGE), 40, 40);
    expect(covered.agreement).toBeGreaterThan(0.9);
    // Same colour everywhere is consistent, so it is judged like any other image:
    expect(
      findOffColour([
        { id: "a", group: 1, read: beige },
        { id: "b", group: 1, read: beige },
        { id: "c", group: 1, read: covered },
      ]),
    ).toEqual(["c"]);
    // A mixed edge (half product, half backdrop) has low agreement and is left alone.
    const mixed = { ...beige, agreement: 0.3 };
    expect(
      findOffColour([
        { id: "a", group: 1, read: beige },
        { id: "b", group: 1, read: beige },
        { id: "c", group: 1, read: mixed },
      ]),
    ).toEqual([]);
  });

  it("judges each colour group on its own", () => {
    const beige = readBorder(solid(40, 40, BEIGE), 40, 40);
    const grey = readBorder(solid(40, 40, GREY), 40, 40);
    expect(
      findOffColour([
        { id: "a", group: 1, read: beige },
        { id: "b", group: 1, read: beige },
        { id: "c", group: 2, read: grey },
        { id: "d", group: 2, read: grey },
      ]),
    ).toEqual([]);
  });
});
