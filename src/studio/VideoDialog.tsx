import { useEffect, useState } from "react";
import { toast } from "sonner";
import { get, post } from "@/api";
import {
  MOTIONS,
  VIDEO_MODEL_NAME,
  VIDEO_RATIOS,
  VIDEO_SECONDS,
  clipCredits,
} from "@shared/video";

export interface VideoItem {
  batch: string;
  id: string;
  name: string;
  skill: string | null;
}

interface VideoState {
  connected: boolean;
  credits: number | null;
  motions: Record<string, string>;
}

const MAX = 12;

/** Turns the chosen images into short clips. Nothing is charged until Start rendering. */
export default function VideoDialog({
  items,
  skillTitle,
  onClose,
  onStarted,
  onConnect,
}: {
  items: VideoItem[];
  skillTitle: (id: string | null) => string;
  onClose: () => void;
  onStarted: () => void;
  onConnect: () => void;
}) {
  const [state, setState] = useState<VideoState | null>(null);
  const [seconds, setSeconds] = useState<number>(VIDEO_SECONDS[0]);
  const [ratio, setRatio] = useState<string>(VIDEO_RATIOS[0]);
  const [motion, setMotion] = useState<string>(MOTIONS[0]);
  const [busy, setBusy] = useState(false);
  const list = items.slice(0, MAX);
  const skill = list[0]?.skill ?? null;

  useEffect(() => {
    get<VideoState>("/api/studio/video?fresh=1")
      .then((s) => {
        setState(s);
        const remembered = skill ? s.motions[skill] : undefined;
        if (remembered) setMotion(remembered);
      })
      .catch(() => setState({ connected: false, credits: null, motions: {} }));
  }, [skill]);

  const cost = clipCredits(seconds) * list.length;
  const short = state?.credits != null && state.credits < cost;
  const remembered = skill ? state?.motions[skill] : undefined;
  const options = [...new Set([...(remembered ? [remembered] : []), ...MOTIONS])];

  async function start() {
    setBusy(true);
    try {
      await post("/api/studio/video/make", {
        items: list.map((i) => ({ batch: i.batch, id: i.id })),
        seconds,
        ratio,
        motion,
      });
      toast.success(list.length === 1 ? "Rendering 1 clip" : `Rendering ${list.length} clips`);
      onStarted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start the clips.");
      setBusy(false);
    }
  }

  return (
    <div className="nx-scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section className="nx-sheet nx-small" role="dialog" aria-modal="true" aria-label="Make video">
        <header>
          <h2>Make video</h2>
          <span className="nx-chip">
            {list.length} image{list.length > 1 ? "s" : ""}
          </span>
          <span className="nx-right">
            <button className="nx-btn nx-sm nx-quiet" onClick={onClose}>
              Close
            </button>
          </span>
        </header>
        <div className="nx-body">
          {state === null ? (
            <p className="nx-muted">Checking the video engine…</p>
          ) : !state.connected ? (
            <>
              <p>
                The video engine is not connected yet. An admin signs in to Higgsfield once on the
                Video page.
              </p>
              <div className="nx-row">
                <button className="nx-btn nx-primary" onClick={onConnect}>
                  Go to Video
                </button>
              </div>
            </>
          ) : (
            <>
              {items.length > MAX && (
                <div className="nx-alert">
                  Clips are made {MAX} at a time. The first {MAX} of your {items.length} images are
                  included.
                </div>
              )}
              <div className="nx-opts">
                <label>
                  <span>Length</span>
                  <select value={seconds} onChange={(e) => setSeconds(Number(e.target.value))}>
                    {VIDEO_SECONDS.map((s) => (
                      <option key={s} value={s}>
                        {s} seconds
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Format</span>
                  <select value={ratio} onChange={(e) => setRatio(e.target.value)}>
                    {VIDEO_RATIOS.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="nx-opt-wide">
                <span>Motion{skill ? `, for ${skillTitle(skill)}` : ""}</span>
                <select
                  value={options.includes(motion) ? motion : "custom"}
                  onChange={(e) => setMotion(e.target.value === "custom" ? "" : e.target.value)}
                >
                  {options.map((m) => (
                    <option key={m} value={m}>
                      {m.length > 78 ? `${m.slice(0, 78)}…` : m}
                    </option>
                  ))}
                  <option value="custom">Write my own</option>
                </select>
              </label>
              {!options.includes(motion) && (
                <textarea
                  rows={3}
                  autoFocus
                  value={motion}
                  onChange={(e) => setMotion(e.target.value)}
                  placeholder="How should the model and the camera move?"
                  aria-label="Motion"
                />
              )}
              <div className="nx-cost">
                <span>{VIDEO_MODEL_NAME} through Higgsfield</span>
                <b className="nx-mono">
                  {cost} credits
                  {state.credits != null ? ` of ${Math.floor(state.credits).toLocaleString("en-US")}` : ""}
                </b>
              </div>
              {short && <div className="nx-alert">Not enough credits on the Higgsfield account.</div>}
              <div className="nx-row">
                <button
                  className="nx-btn nx-primary"
                  disabled={busy || short || motion.trim().length < 3}
                  onClick={() => void start()}
                >
                  {busy ? "Starting…" : "Start rendering"}
                </button>
                <span className="nx-muted">The clothes, face and background stay as in the image.</span>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
