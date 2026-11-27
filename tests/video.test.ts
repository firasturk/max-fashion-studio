import { describe, expect, it } from "vitest";
import { clipCredits, clipPrompt, jobIdOf, jobStateOf, mediaIdOf, MOTION_GUARD } from "@shared/video";

const JOB = "68b69b22-06eb-4d4d-9034-1358e9c6e5cd";

describe("video answers from the engine", () => {
  it("reads the media id of an imported still", () => {
    expect(mediaIdOf({ media_id: "a34db8ef-736e-475e-9249-b547ba0810d7", type: "image" })).toBe(
      "a34db8ef-736e-475e-9249-b547ba0810d7",
    );
    expect(mediaIdOf({ text: "no id here" })).toBeNull();
  });

  it("reads the job id of a submitted clip, not the image it started from", () => {
    const answer = {
      results: [
        {
          id: JOB,
          type: "video",
          status: "pending",
          params: { reference_images: ["9ab07acd-7201-4555-a5d6-714be44fe9bf"] },
        },
      ],
    };
    expect(jobIdOf(answer)).toBe(JOB);
    expect(jobIdOf({ results: [] })).toBeNull();
  });

  it("keeps waiting while the clip renders", () => {
    const answer = { jobs: [{ index: 0, job_id: JOB, status: "in_progress", type: "video" }] };
    expect(jobStateOf(answer, JOB)).toEqual({ state: "pending" });
  });

  it("reads a finished clip as the engine reports it", () => {
    const result_url = `https://d8j0ntlcm91z4.cloudfront.net/user_x/hf_20261127_105451_${JOB}.mp4`;
    const answer = {
      jobs: [{ index: 0, job_id: JOB, status: "completed", type: "video", model: "kling3_0_turbo", result_url }],
      all_terminal: true,
    };
    expect(jobStateOf(answer, JOB)).toEqual({ state: "done", url: result_url });
  });

  it("finds the finished file wherever the engine puts it", () => {
    const url = "https://cdn.example.com/out/clip.mp4?sig=abc";
    expect(jobStateOf({ jobs: [{ job_id: JOB, status: "completed", result: { url } }] }, JOB)).toEqual({
      state: "done",
      url,
    });
    expect(jobStateOf({ jobs: [{ job_id: JOB, status: "completed", results: [{ raw: { url } }] }] }, JOB)).toEqual({
      state: "done",
      url,
    });
  });

  it("reports refusals in plain words", () => {
    expect(jobStateOf({ jobs: [{ job_id: JOB, status: "nsfw" }] }, JOB).state).toBe("failed");
    const lost = jobStateOf({ jobs: [{ job_id: JOB, status: "lookup_failed", error: "Generation not found" }] }, JOB);
    expect(lost).toEqual({ state: "failed", message: "Generation not found" });
  });
});

describe("clip settings", () => {
  it("prices five seconds at 7.5 credits", () => {
    expect(clipCredits(5)).toBe(7.5);
    expect(clipCredits(10)).toBe(15);
  });

  it("always tells the engine to leave the product alone", () => {
    expect(clipPrompt("Slow walk toward the camera.")).toBe(`Slow walk toward the camera. ${MOTION_GUARD}`);
    expect(clipPrompt("   ")).toContain(MOTION_GUARD);
  });
});
