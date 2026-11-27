import { describe, expect, it } from "vitest";
import { isShopBoard, parsePinterestLink, pinImage, readPins } from "@shared/pinterest";

describe("Pinterest links", () => {
  it("reads a board link, with or without a country site", () => {
    expect(parsePinterestLink("https://www.pinterest.com/maxfashion/winter-denim/")).toEqual({
      kind: "board",
      user: "maxfashion",
      board: "winter-denim",
    });
    expect(parsePinterestLink("ar.pinterest.com/maxfashion/winter-denim/street/?x=1")).toEqual({
      kind: "board",
      user: "maxfashion",
      board: "winter-denim",
    });
    expect(parsePinterestLink("https://www.pinterest.co.uk/someone/mood/")?.kind).toBe("board");
  });

  it("reads a single pin and the app's short links", () => {
    expect(parsePinterestLink("https://www.pinterest.com/pin/424605071136961057/")).toEqual({
      kind: "pin",
      id: "424605071136961057",
    });
    expect(
      parsePinterestLink("https://www.pinterest.com/pin/red-coat--424605071136961057/"),
    ).toEqual({
      kind: "pin",
      id: "424605071136961057",
    });
    expect(parsePinterestLink("https://pin.it/4AbCdEf")).toEqual({
      kind: "short",
      url: "https://pin.it/4AbCdEf",
    });
  });

  it("reads an account page as all of its public pins", () => {
    expect(parsePinterestLink("https://www.pinterest.com/zaraofficial/")).toEqual({
      kind: "user",
      user: "zaraofficial",
    });
    expect(parsePinterestLink("pinterest.com/zaraofficial/_saved/")).toEqual({
      kind: "user",
      user: "zaraofficial",
    });
  });

  it("refuses pages that are not a board or a pin, and other sites", () => {
    expect(parsePinterestLink("https://www.pinterest.com/search/pins/?q=denim")).toBeNull();
    expect(parsePinterestLink("https://www.pinterest.com/pin/")).toBeNull();
    expect(parsePinterestLink("https://evil.example/pinterest.com/a/b")).toBeNull();
    expect(parsePinterestLink("https://notpinterest.com/a/b")).toBeNull();
  });
});

describe("Pinterest pictures", () => {
  const url = "https://i.pinimg.com/564x/dc/59/c7/dc59c78056607f0250deb7611d387731.jpg";

  it("asks Pinterest's image host for the size it needs, and nobody else", () => {
    expect(pinImage(url, "736x")).toBe(
      "https://i.pinimg.com/736x/dc/59/c7/dc59c78056607f0250deb7611d387731.jpg",
    );
    expect(pinImage("https://example.com/564x/dc/59/c7/a.jpg", "736x")).toBeNull();
    expect(pinImage("https://i.pinimg.com/564x/../../secret.jpg", "736x")).toBeNull();
  });

  it("keeps the stills of a board once each and drops videos", () => {
    const pins = readPins([
      { id: "1", description: " Wide trousers ", is_video: false, images: { "564x": { url } } },
      { id: "2", is_video: true, images: { "564x": { url: url.replace("dc59c7", "aa59c7") } } },
      { id: "3", images: { "236x": { url: url.replace("564x", "236x") } } },
      { id: "4", images: {} },
    ]);
    expect(pins).toEqual([
      {
        id: "1",
        thumb: "https://i.pinimg.com/236x/dc/59/c7/dc59c78056607f0250deb7611d387731.jpg",
        image: "https://i.pinimg.com/736x/dc/59/c7/dc59c78056607f0250deb7611d387731.jpg",
        note: "Wide trousers",
        board: "",
        boardUrl: "",
        twin: "pin|1",
      },
    ]);
  });
});

describe("the Pinterest library", () => {
  const url = "https://i.pinimg.com/236x/dc/59/c7/dc59c78056607f0250deb7611d387731.jpg";
  const raw = (id: string, file: string, color: string) => ({
    id,
    dominant_color: color,
    board: { name: "New in Woman", url: "/shop/new-in-woman/" },
    images: {
      "236x": {
        url: url.replace("dc59c78056607f0250deb7611d387731", file),
        width: 236,
        height: 354,
      },
    },
  });

  it("marks the same picture posted again with other text as a twin", () => {
    const pins = readPins([
      raw("1", "aa59c78056607f0250deb7611d387731", "#373737"),
      raw("2", "bb59c78056607f0250deb7611d387731", "#373737"),
      raw("3", "cc59c78056607f0250deb7611d387731", "#bdb7ae"),
    ]);
    expect(pins.map((p) => p.twin)).toEqual([
      "/shop/new-in-woman/|#373737|236x354",
      "/shop/new-in-woman/|#373737|236x354",
      "/shop/new-in-woman/|#bdb7ae|236x354",
    ]);
    expect(pins[0].boardUrl).toBe("/shop/new-in-woman/");
  });

  it("leaves out product feeds and advert boards", () => {
    expect(isShopBoard("Products", "/massimodutti/_products/")).toBe(true);
    expect(isShopBoard("Pin exclusivamente publicitario", "/massimodutti/pin-x/")).toBe(true);
    expect(isShopBoard("New in Woman", "/massimodutti/new-in-woman/")).toBe(false);
    expect(isShopBoard("Street style", "")).toBe(false);
  });
});
