import { FolderOpen, LoaderCircle, Trash2 } from "lucide-react";
import type { Batch } from "@shared/types";
import type { Config } from "@shared/config";
import { MODES } from "./constants";

const STATE_LABEL: Record<string, string> = {
  idle: "Idle",
  running: "Generating",
  paused: "Paused",
};

export default function BatchesView({
  batches,
  busyId,
  onOpen,
  onDelete,
}: {
  batches: Batch[];
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
        <span>Category</span>
        <span>Progress</span>
        <span>Status</span>
        <span />
      </div>
      {batches.map((b) => {
        const cfg = JSON.parse(b.config) as Config;
        const mode = MODES.find((m) => m.id === cfg.mode);
        const total = b.total ?? 0;
        const done = b.completed ?? 0;
        const pct = total ? Math.round((done / total) * 100) : 0;
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
          <div className="batches-row" role="row" key={b.id}>
            <span className="batches-name">
              <strong>{b.name}</strong>
              <small>{new Date(b.created).toLocaleString("en-GB")}</small>
            </span>
            <span>{mode?.title ?? cfg.mode}</span>
            <span>{cfg.category}</span>
            <span className="batches-progress">
              <span className="bar">
                <span style={{ width: `${pct}%` }} />
              </span>
              <small>
                {done}/{total}
              </small>
            </span>
            <span className={`batches-status ${b.state}`}>{status}</span>
            <span className="footer-actions">
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
