/**
 * Event tracking: every click and decision in the studio goes to the server in small batches,
 * where it joins the engine's own events. Nothing here ever blocks the interface: a failed send
 * is dropped, and the buffer is flushed with a beacon when the tab closes.
 */
import { post } from "@/api";

export interface TrackContext {
  batch?: string | null;
  skill?: string | null;
  mode?: string | null;
}

interface TrackedEvent extends TrackContext {
  kind: string;
  at: number;
  task?: string | null;
  source?: string | null;
  data?: Record<string, unknown>;
}

let context: TrackContext = {};
const buffer: TrackedEvent[] = [];
let timer: number | undefined;
let enabled = false;

/** The batch, skill and approach the user is looking at, attached to every event. */
export function setTrackContext(next: TrackContext): void {
  context = { ...context, ...next };
}

export function track(
  kind: string,
  data?: Record<string, unknown>,
  refs?: TrackContext & { task?: string | null; source?: string | null },
): void {
  if (!enabled) return;
  buffer.push({ kind, at: Date.now(), ...context, ...refs, data });
  if (buffer.length >= 25) void flush();
  else if (timer === undefined) timer = window.setTimeout(() => void flush(), 4000);
}

export async function flush(useBeacon = false): Promise<void> {
  window.clearTimeout(timer);
  timer = undefined;
  if (!buffer.length) return;
  const events = buffer.splice(0, 200);
  if (useBeacon && navigator.sendBeacon) {
    navigator.sendBeacon(
      "/api/studio/events",
      new Blob([JSON.stringify({ events })], { type: "application/json" }),
    );
    return;
  }
  try {
    await post("/api/studio/events", { events });
  } catch {
    // Dropped: tracking never gets in the way.
  }
}

/** What a clicked element is called, for the record: its label, text or aria name. */
function labelOf(el: Element): string {
  const aria = el.getAttribute("aria-label") || el.getAttribute("title");
  const text = (el.textContent || "").replace(/\s+/g, " ").trim();
  return (aria || text || el.getAttribute("name") || el.id || el.tagName.toLowerCase()).slice(
    0,
    80,
  );
}

const CLICKABLE =
  'button, a, [role="button"], [role="tab"], [role="switch"], [role="checkbox"], [role="menuitem"], [role="option"], summary, input[type="checkbox"], input[type="radio"], label';

/** Start recording: a global click listener plus a flush when the tab goes away. */
export function startTracking(): void {
  if (enabled) return;
  enabled = true;
  document.addEventListener(
    "click",
    (e) => {
      const target = (e.target as Element | null)?.closest(CLICKABLE);
      if (!target) return;
      const card = target.closest<HTMLElement>("[data-task],[data-source]");
      track(
        "click",
        {
          label: labelOf(target),
          tag: target.tagName.toLowerCase(),
          role: target.getAttribute("role") || undefined,
          page: location.pathname + location.hash,
        },
        { task: card?.dataset.task ?? null, source: card?.dataset.source ?? null },
      );
    },
    true,
  );
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush(true);
  });
  window.addEventListener("pagehide", () => void flush(true));
}
