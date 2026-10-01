import { describe, expect, it, vi } from "vitest";
import {
  FalClient,
  decodeFalHandle,
  encodeFalHandle,
  falSize,
  isFalModel,
  falModelId,
} from "../server/fal";
import { estimateCost } from "../shared/pricing";
import { DEFAULT_CONFIG } from "../shared/config";

const KEY = "11111111-2222-3333-4444-555555555555:abcdef0123456789abcdef";

describe("fal.ai client", () => {
  it("recognises fal slugs and strips the prefix", () => {
    expect(isFalModel("fal/bytedance/seedream/v5/pro/edit")).toBe(true);
    expect(isFalModel("gemini-3-pro-image")).toBe(false);
    expect(falModelId("fal/bytedance/seedream/v5/pro/edit")).toBe("bytedance/seedream/v5/pro/edit");
  });
  it("maps frames to sizes within Seedream limits", () => {
    expect(falSize("1:1", "2K")).toEqual({ width: 2048, height: 2048 });
    expect(falSize("2:3", "2K")).toEqual({ width: 1360, height: 2048 });
    expect(falSize("4:5", "1K")).toEqual({ width: 1232, height: 1536 });
    expect(falSize("3:4", "4K")).toEqual({ width: 1536, height: 2048 });
  });
  it("submits to the queue with data-URI references and polls to a downloaded image", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      calls.push(u);
      if (u === "https://queue.fal.run/bytedance/seedream/v5/pro/edit") {
        expect((init?.headers as Record<string, string>).Authorization).toBe(`Key ${KEY}`);
        const body = JSON.parse(String(init?.body));
        expect(body.image_urls[0]).toMatch(/^data:image\/jpeg;base64,/);
        expect(body.image_size).toEqual({ width: 2048, height: 2048 });
        return new Response(
          JSON.stringify({
            request_id: "req1",
            status_url: "https://queue.fal.run/bytedance/requests/req1/status",
            response_url: "https://queue.fal.run/bytedance/requests/req1",
          }),
          { status: 200 },
        );
      }
      if (u.endsWith("/req1/status")) return new Response(JSON.stringify({ status: "COMPLETED" }));
      if (u.endsWith("/req1"))
        return new Response(JSON.stringify({ images: [{ url: "https://cdn.fal/x.png" }] }));
      if (u === "https://cdn.fal/x.png")
        return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } });
      throw new Error("unexpected " + u);
    });
    const client = new FalClient(KEY, fetchMock as unknown as typeof fetch);
    const handle = await client.submit({
      model: "fal/bytedance/seedream/v5/pro/edit",
      prompt: "p",
      images: [{ bytes: new ArrayBuffer(4), mime: "image/jpeg" }],
      aspectRatio: "1:1",
      size: "2K",
    });
    const encoded = encodeFalHandle(handle);
    expect(encoded.startsWith("fal:")).toBe(true);
    const status = await client.status(decodeFalHandle(encoded));
    expect(status.state).toBe("done");
    if (status.state === "done") expect(status.image.bytes.byteLength).toBe(3);
  });
  it("reports pending and failed states", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith("/status")) return new Response(JSON.stringify({ status: "IN_PROGRESS" }));
      return new Response("{}", { status: 500 });
    });
    const client = new FalClient(KEY, fetchMock as unknown as typeof fetch);
    const h = { requestId: "r", statusUrl: "https://q/r/status", responseUrl: "https://q/r" };
    expect((await client.status(h)).state).toBe("pending");
  });
  it("prices Seedream 5 Pro with the first reference free", () => {
    const c = { ...DEFAULT_CONFIG, mode: "5" as const, model: "fal/bytedance/seedream/v5/pro/edit", size: "2K" as const };
    const e = estimateCost(c, 1);
    expect(e.known).toBe(true);
    expect(e.perImage).toBeCloseTo(0.135 + 0.01, 3);
  });
});
