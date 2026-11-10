/**
 * One image generation per Durable Object. A queue consumer scales up slowly (a burst of images
 * ran one or two at a time for minutes); an object starts at once, has its own connections and may
 * run for many minutes in its alarm, so a batch's whole width is in flight within a second.
 */
import type { Env, ImageJob } from "./env";
import { errorMessage } from "./errors";
import { runImageJob } from "./engine";

export class ImageRunner {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  /** The driver hands the job over; the alarm runs it after this short request has answered. */
  async fetch(request: Request): Promise<Response> {
    const job = (await request.json()) as ImageJob;
    await this.state.storage.put("job", job);
    await this.state.storage.setAlarm(Date.now());
    return new Response(null, { status: 202 });
  }

  async alarm(): Promise<void> {
    const job = await this.state.storage.get<ImageJob>("job");
    // Cleared first: an alarm retried after a crash must not generate (and bill) the image twice.
    await this.state.storage.deleteAll();
    if (!job) return;
    try {
      await runImageJob(this.env, job);
    } catch (e) {
      console.error("[runner]", job.task, errorMessage(e));
    }
  }
}
