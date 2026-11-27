import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { del, get, post } from "@/api";
import { VIDEO_MODEL_NAME, type Clip } from "@shared/video";

interface VideoState {
  connected: boolean;
  credits: number | null;
  clips: Clip[];
}

const sku = (name: string) => name.replace(/\.[^.]+$/, "");

/** Clips rendered from finished images. The garment stays exactly as in the still. */
export default function VideoPage({
  admin,
  onCount,
  onPick,
}: {
  admin: boolean;
  onCount: (open: number, connected: boolean) => void;
  onPick: () => void;
}) {
  const [state, setState] = useState<VideoState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await get<VideoState>("/api/studio/video");
      setState(s);
      onCount(s.clips.filter((c) => c.status !== "approved" && c.status !== "failed").length, s.connected);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load the clips.");
    }
  }, [onCount]);
  useEffect(() => void load(), [load]);

  const rendering = (state?.clips ?? []).some((c) => c.status === "queued" || c.status === "rendering");
  useEffect(() => {
    if (!rendering) return;
    const t = window.setInterval(() => !document.hidden && void load(), 8_000);
    return () => window.clearInterval(t);
  }, [rendering, load]);

  async function act(id: string, fn: () => Promise<unknown>, done?: string) {
    setBusy(id);
    try {
      await fn();
      if (done) toast.success(done);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That did not work. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function connect() {
    setBusy("connect");
    try {
      const { url } = await post<{ url: string }>("/api/studio/video/connect");
      window.location.href = url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start the sign-in.");
      setBusy(null);
    }
  }

  const clips = state?.clips ?? [];
  return (
    <div className="nx nx-enter">
      <div className="nx-head">
        <div>
          <h1>Video</h1>
          <p>
            Short clips made from finished images, so the garment stays exactly as shot. Rendered by{" "}
            {VIDEO_MODEL_NAME} through Higgsfield.
          </p>
        </div>
        <div className="nx-right">
          {state?.connected && state.credits != null && (
            <span className="nx-chip nx-mono">{Math.floor(state.credits).toLocaleString("en-US")} credits</span>
          )}
          {state?.connected && (
            <button className="nx-btn nx-primary" onClick={onPick}>
              Pick images in Review
            </button>
          )}
          {state?.connected && admin && (
            <button
              className="nx-btn nx-quiet"
              onClick={() =>
                void act("off", () => del("/api/studio/video/connect"), "Higgsfield disconnected")
              }
            >
              Disconnect
            </button>
          )}
        </div>
      </div>
      {state === null ? null : !state.connected ? (
        <div className="nx-empty">
          <b>Connect Higgsfield once</b>
          {admin
            ? "Sign in with the Higgsfield account that holds the credits. The studio then renders clips on it."
            : "Ask an admin to sign in to Higgsfield from this page."}
          {admin && (
            <div className="nx-row nx-center">
              <button className="nx-btn nx-primary" disabled={busy === "connect"} onClick={() => void connect()}>
                {busy === "connect" ? "Opening Higgsfield…" : "Sign in to Higgsfield"}
              </button>
            </div>
          )}
        </div>
      ) : !clips.length ? (
        <div className="nx-empty">
          <b>No clips yet</b>
          Select images in Review and choose Make video. A 5 second clip costs 7.5 credits.
        </div>
      ) : (
        <div className="nx-clips nx-stagger">
          {clips.map((c) => {
            const file = `/api/studio/video/file?id=${c.id}`;
            const live = c.status === "queued" || c.status === "rendering";
            return (
              <article className={`nx-clip ${live ? "nx-busy" : ""}`} key={c.id}>
                <div className="nx-frame" data-ratio={c.ratio}>
                  {c.status === "ready" || c.status === "approved" ? (
                    <video src={file} poster={`${file}&kind=poster`} controls loop muted playsInline preload="none" />
                  ) : (
                    <>
                      <img src={`${file}&kind=poster`} alt={`First frame of the clip for ${sku(c.name)}`} loading="lazy" />
                      {live && <span className="nx-spin" role="img" aria-label="Rendering" />}
                    </>
                  )}
                  <span className="nx-dur">
                    {c.seconds}s · {c.ratio}
                  </span>
                </div>
                <div className="nx-meta">
                  <span className="nx-mono nx-sku">{sku(c.name)}</span>
                  <span className="nx-row">
                    {live ? (
                      <span className="nx-chip nx-warn">Rendering</span>
                    ) : c.status === "approved" ? (
                      <span className="nx-chip nx-ok">Approved</span>
                    ) : c.status === "failed" ? (
                      <span className="nx-chip nx-bad">Failed</span>
                    ) : (
                      <span className="nx-chip nx-ok">Ready</span>
                    )}
                    <span className="nx-chip">{c.credits} cr</span>
                  </span>
                  {c.status === "failed" && c.error && <span className="nx-muted">{c.error}</span>}
                  {!live && (
                    <span className="nx-row">
                      {c.status === "ready" && (
                        <button
                          className="nx-btn nx-sm nx-primary"
                          disabled={busy === c.id}
                          onClick={() => void act(c.id, () => post("/api/studio/video/approve", { id: c.id }))}
                        >
                          Approve
                        </button>
                      )}
                      {(c.status === "ready" || c.status === "approved") && (
                        <a className="nx-btn nx-sm" href={`${file}&download=1`}>
                          Download
                        </a>
                      )}
                      <button
                        className="nx-btn nx-sm"
                        disabled={busy === c.id}
                        title={`Renders again for ${c.credits} credits`}
                        onClick={() =>
                          window.confirm(`Render this clip again? It costs ${c.credits} credits.`) &&
                          void act(c.id, () => post("/api/studio/video/redo", { id: c.id }), "Rendering again")
                        }
                      >
                        Redo
                      </button>
                      <button
                        className="nx-btn nx-sm nx-quiet"
                        disabled={busy === c.id}
                        onClick={() => void act(c.id, () => del(`/api/studio/video?id=${c.id}`))}
                      >
                        Delete
                      </button>
                    </span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
