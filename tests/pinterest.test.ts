import { describe, expect, it } from "vitest";
import { groupByBoard, originKey, parsePinterestLink, pinImage, readPins } from "@shared/pinterest";

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
      },
    ]);
  });
});

describe("looks to propose", () => {
  it("sorts an account's pins into its boards, biggest first", () => {
    const pin = (id: string, board: string) => ({ id, thumb: "t", image: id, note: "", board });
    const groups = groupByBoard(
      [pin("1", "Denim"), pin("2", "Tailoring"), pin("3", "Denim"), pin("4", "")],
      "Zara",
    );
    expect(groups.map((g) => [g.board, g.pins.length])).toEqual([
      ["Denim", 2],
      ["Tailoring", 1],
      ["Zara", 1],
    ]);
  });

  it("names a board the same way every time", () => {
    expect(originKey("ZaraOfficial", "Autumn / Winter '26")).toBe("zaraofficial/autumn-winter-26");
  });
});
