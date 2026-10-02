import { FolderOpen, LoaderCircle, Trash2 } from "lucide-react";
import type { Batch, SkillInfo } from "@shared/types";
import type { Config } from "@shared/config";

import { MODES, type ModeInfo } from "./constants";

const STATE_LABEL: Record<string, string> = {
  idle: "Idle",
  running: "Generating",
  paused: "Paused",
};

function ago(ts: number): string {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(ts).toLocaleDateString("en-GB");
}

export default function BatchesView({
  batches,
  busyId,
  onOpen,
  onDelete,
  skills = [],
  modes = MODES,
}: {
  batches: Batch[];
  skills?: SkillInfo[];
  modes?: ModeInfo[];
  busyId: string | null;
  onOpen: (id: string) => void;
  onDelete: (b: Batch) => void;
}) {
  if (!batches.length) {
    return (
      <div className="empty-results">
        <div className="empty-grid-icon">
          <FolderOpen size={36} />
        </div>
        <h3>No saved batches yet.</h3>
        <p>
          Every batch you save appears here with its progress. Open one to review, revise or export.
        </p>
      </div>
    );
  }
  return (
    <div className="batches-table" role="table" aria-label="Saved batches">
      <div className="batches-head" role="row">
        <span>Batch</span>
        <span>Workflow</span>
        <span>Progress</span>
        <span>Spent</span>
        <span>Status</span>
        <span />
      </div>
      {batches.map((b) => {
        const cfg = JSON.parse(b.config) as Config;
        const mode = modes.find((m) => m.id === cfg.mode);
        const total = b.total ?? 0;
        const done = b.completed ?? 0;
        const pct = total ? Math.round((done / total) * 100) : 0;
        const tone =
          b.state === "running"
            ? "running"
            : b.state === "paused" || b.failed
              ? "warn"
              : b.review
                ? "review"
                : total && done === total
                  ? "done"
                  : "idle";
        const status =
          b.state === "running"
            ? "Generating"
            : b.state === "paused"
              ? `Paused${b.last_error ? " · " + b.last_error : ""}`
              : b.failed
                ? `${b.failed} failed`
                : b.review
                  ? `${b.review} to review`
                  : total && done === total
                    ? "Complete"
                    : STATE_LABEL[b.state];
        return (
          <div className="batches-row" role="row" key={b.id} onDoubleClick={() => onOpen(b.id)}>
            <span className="batches-name">
              <span className="batch-thumbs" aria-hidden="true">
                {(b.thumbs ?? []).map((t) => (
                  <img
                    key={t}
                    src={`/api/studio/file?batch=${b.id}&id=${t}&kind=result`}
                    alt=""
                    loading="lazy"
                  />
                ))}
                {!(b.thumbs ?? []).length && <span className="batch-thumb-empty" />}
              </span>
              <span>
                <strong>{b.name}</strong>
                <small>
                  {new Date(b.created).toLocaleDateString("en-GB")} · updated {ago(b.updated)}
                </small>
              </span>
            </span>
            <span>
              {cfg.mode === "5"
                ? `Skill · ${skills.find((s) => s.id === cfg.skill)?.title ?? cfg.skill}`
                : (mode?.title ?? cfg.mode)}
            </span>
            <span className="batches-progress">
              <span className="bar">
                <span style={{ width: `${pct}%` }} />
              </span>
              <small>
                {done}/{total}
              </small>
            </span>
            <span>{b.spent ? `≈ $${b.spent.toFixed(2)}` : "–"}</span>
            <span className={`batches-status ${tone}`}>
              <i className="status-dot" />
              {status}
            </span>
            <span className="footer-actions row-actions">
              <button className="secondary" onClick={() => onOpen(b.id)} disabled={busyId === b.id}>
                {busyId === b.id ? (
                  <LoaderCircle className="spinning" size={15} />
                ) : (
                  <FolderOpen size={15} />
                )}{" "}
                Open
              </button>
              <button
                className="secondary danger"
                onClick={() => onDelete(b)}
                disabled={b.state === "running"}
                aria-label={`Delete ${b.name}`}
              >
                <Trash2 size={15} />
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
}
