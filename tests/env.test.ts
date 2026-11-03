import { describe, expect, it } from "vitest";
import { concurrency, vertexWidth, type Env } from "../server/env";

const base = { HIGGSFIELD_MODEL: "", HIGGSFIELD_BASE_URL: "" } as unknown as Env;

describe("engine widths", () => {
  it("caps an isolate's synchronous generations at six connections", () => {
    expect(concurrency(base)).toBe(6);
    expect(concurrency({ ...base, MAX_CONCURRENT_GENERATIONS: "40" })).toBe(6);
    expect(concurrency({ ...base, MAX_CONCURRENT_GENERATIONS: "3" })).toBe(3);
  });
  it("lets the queue width follow the Vertex quota, not the connection rule", () => {
    expect(vertexWidth(base)).toBe(12);
    expect(vertexWidth({ ...base, VERTEX_PARALLEL: "40" })).toBe(40);
    expect(vertexWidth({ ...base, VERTEX_PARALLEL: "nonsense" })).toBe(12);
    expect(vertexWidth({ ...base, VERTEX_PARALLEL: "0" })).toBe(12);
  });
});
