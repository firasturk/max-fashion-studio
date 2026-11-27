import { useState } from "react";
import { toast } from "sonner";
import { post } from "@/api";
import type { Batch, SkillInfo } from "@shared/types";
import { isSkillCampaign, type Config } from "@shared/config";

import { MODES, isFinished, type ModeInfo } from "./constants";
import { skillTone } from "./tone";

function when(ts: number): string {
  return new Date(ts).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Thumbs({ b }: { b: Batch }) {
  return (
    <span className="nx-thumbs" aria-hidden="true">
      {(b.thumbs ?? []).map((t) => (
        <img
          key={t}
          src={`/api/studio/file?batch=${b.id}&id=${t}&kind=result&w=160`}
          alt=""
          loading="lazy"
        />
      ))}
    </span>
  );
}

/** Running (work the engine still owes) and Delivered (finished batches): two views of the batch list. */
export default function PipelinePage({
  view,
  batches,
  skills,
  modes = MODES,
  busyId,
  onOpen,
  onDelete,
  onReview,
  onRefresh,
}: {
  view: "running" | "delivered";
  batches: Batch[];
  skills: SkillInfo[];
  modes?: ModeInfo[];
  busyId: string | null;
  onOpen: (id: string) => void;
  onDelete: (b: Batch) => void;
  onReview: () => void;
  onRefresh: () => Promise<void> | void;
}) {
  const [acting, setActing] = useState<string | null>(null);
  const tone = (b: Batch) => {
    const cfg = JSON.parse(b.config) as Config;
    return skillTone(
      isSkillCampaign(cfg.mode) || cfg.mode === "7" ? cfg.skill : `mode-${cfg.mode}`,
    );
  };
  const label = (b: Batch) => {
    const cfg = JSON.parse(b.config) as Config;
    if (isSkillCampaign(cfg.mode) || cfg.mode === "7")
      return (
        skills.find((s) => s.id === cfg.skill)?.title ??
        modes.find((m) => m.id === cfg.mode)?.title ??
        cfg.skill
      );
    return modes.find((m) => m.id === cfg.mode)?.title ?? cfg.mode;
  };

  async function toggle(b: Batch) {
    setActing(b.id);
    try {
      await post(b.state === "running" ? "/api/studio/pause" : "/api/studio/start", {
        batch: b.id,
      });
      await onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That did not work. Try again.");
    } finally {
      setActing(null);
    }
  }

  if (view === "delivered") {
    const done = batches.filter(isFinished);
    return (
      <div className="nx nx-enter">
        <div className="nx-head">
          <div>
            <h1>Delivered</h1>
            <p>
              Finished batches. Open one to download its ZIP or send an image back for another try.
            </p>
          </div>
        </div>
        {done.length ? (
          <div className="nx-tablewrap">
            <table className="nx-table">
              <thead>
                <tr>
                  <th>Batch</th>
                  <th className="nx-n">Images</th>
                  <th className="nx-n">Approved</th>
                  <th className="nx-n">To review</th>
                  <th className="nx-n">Spent</th>
                  <th>Finished</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {done.map((b) => (
                  <tr key={b.id} onDoubleClick={() => onOpen(b.id)}>
                    <td>
                      <span className="nx-batchcell">
                        <Thumbs b={b} />
                        <span>
                          <b>{b.name}</b>
                          <span className={tone(b)}>{label(b)}</span>
                        </span>
                      </span>
                    </td>
                    <td className="nx-n nx-mono">{b.completed ?? 0}</td>
                    <td className="nx-n nx-mono">{b.approved ?? 0}</td>
                    <td className="nx-n nx-mono">
                      {(b.review ?? 0) + (b.failed ?? 0) ? (
                        <span className="nx-chip nx-warn">{(b.review ?? 0) + (b.failed ?? 0)}</span>
                      ) : (
                        "0"
                      )}
                    </td>
                    <td className="nx-n nx-mono">{b.spent ? `$${b.spent.toFixed(2)}` : "–"}</td>
                    <td className="nx-muted">{when(b.updated)}</td>
                    <td>
                      <span className="nx-row nx-end">
                        <button
                          className="nx-btn nx-sm"
                          disabled={busyId === b.id}
                          onClick={() => onOpen(b.id)}
                        >
                          {busyId === b.id ? "Opening…" : "Open"}
                        </button>
                        <button
                          className="nx-btn nx-sm nx-quiet"
                          onClick={() => onDelete(b)}
                          aria-label={`Delete ${b.name}`}
                        >
                          Delete
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="nx-empty">
            <b>Nothing delivered yet</b>A batch moves here when every image in it has been
            generated.
          </div>
        )}
      </div>
    );
  }

  const open = batches.filter((b) => !isFinished(b));
  return (
    <div className="nx nx-enter">
      <div className="nx-head">
        <div>
          <h1>Running</h1>
          <p>
            Live batches. The studio retries rate limits and refusals by itself and only stops for
            billing problems.
          </p>
        </div>
      </div>
      {open.length ? (
        <div className="nx-runs nx-stagger">
          {open.map((b) => {
            const total = b.total ?? 0;
            const review = b.review ?? 0;
            const failed = b.failed ?? 0;
            const ok = Math.max(0, (b.completed ?? 0) - review);
            const left = b.queued ?? 0;
            const pct = (n: number) => (total ? `${((n / total) * 100).toFixed(1)}%` : "0%");
            return (
              <article className="nx-run" key={b.id}>
                <div className="nx-row">
                  <Thumbs b={b} />
                  <div className="nx-name">{b.name}</div>
                  <span className={tone(b)}>{label(b)}</span>
                  {b.state === "running" ? (
                    <span className="nx-chip nx-ok">Generating</span>
                  ) : b.state === "paused" ? (
                    <span className="nx-chip nx-warn">Paused</span>
                  ) : (
                    <span className="nx-chip">{total ? "Not started" : "No images yet"}</span>
                  )}
                  <span className="nx-row nx-end">
                    {total > 0 && (
                      <button
                        className="nx-btn nx-sm"
                        disabled={acting === b.id}
                        onClick={() => void toggle(b)}
                      >
                        {b.state === "running"
                          ? "Pause"
                          : b.state === "paused"
                            ? "Resume"
                            : "Start"}
                      </button>
                    )}
                    {ok + review > 0 && (
                      <button className="nx-btn nx-sm" onClick={onReview}>
                        Open in Review
                      </button>
                    )}
                    <button
                      className="nx-btn nx-sm"
                      disabled={busyId === b.id}
                      onClick={() => onOpen(b.id)}
                    >
                      {busyId === b.id ? "Opening…" : "Open batch"}
                    </button>
                    <button
                      className="nx-btn nx-sm nx-quiet"
                      disabled={b.state === "running"}
                      onClick={() => onDelete(b)}
                    >
                      Delete
                    </button>
                  </span>
                </div>
                {b.state === "paused" && b.last_error && (
                  <div className="nx-alert">{b.last_error}</div>
                )}
                <div
                  className="nx-stack"
                  role="img"
                  aria-label={`${total - left} of ${total} finished`}
                >
                  <i className="nx-g" style={{ width: pct(ok) }} />
                  <i className="nx-w" style={{ width: pct(review) }} />
                  <i className="nx-r" style={{ width: pct(failed) }} />
                </div>
                <div className="nx-stats">
                  <span>
                    <b>{total - left}</b> of {total} finished
                  </span>
                  <span>
                    <b>{ok}</b> passed QC
                  </span>
                  <span>
                    <b>{review}</b> need a look
                  </span>
                  <span>
                    <b>{failed}</b> failed
                  </span>
                  <span className="nx-mono">{b.spent ? `$${b.spent.toFixed(2)} spent` : ""}</span>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="nx-empty">
          <b>Nothing is running</b>
          Approve a folder in the Inbox to start a batch.
        </div>
      )}
    </div>
  );
}
