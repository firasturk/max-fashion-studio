import { useState } from "react";
import { Check, FileImage, LoaderCircle, RotateCcw, ScanLine, ZoomIn } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { STATUS_LABEL } from "./constants";
import type { Source, Task } from "@shared/types";

function cardLabel(mode: string, card: number): string {
  if (mode === "1")
    return card === 1 ? "Lifestyle" : card === 6 ? "Fabric detail" : `Studio ${card - 1}`;
  if (mode === "4") return `Background ${card}`;
  if (mode === "3") return `Pose ${card}`;
  if (mode === "5") return `Editorial ${card}`;
  if (mode === "6") return `Colour ${card}`;
  return `Lifestyle ${card}`;
}

export default function ResultsTab({
  tasks,
  sources,
  mode,
  running,
  selection,
  outputUrl,
  onSelect,
  onClearSelection,
  onOpen,
  onRetryTask,
  onApproveAll,
}: {
  tasks: Task[];
  sources: Source[];
  mode: string;
  running: boolean;
  selection: Set<string>;
  outputUrl: (t: Task) => string;
  onSelect: (id: string, on: boolean) => void;
  onClearSelection: () => void;
  onOpen: (t: Task) => void;
  onRetryTask: (t: Task) => void;
  onApproveAll?: () => void;
}) {
  const PAGE = 48;
  const [limit, setLimit] = useState(PAGE);
  if (!tasks.length) {
    return (
      <div className="empty-results">
        <div className="empty-grid-icon">
          <ScanLine size={36} />
        </div>
        <h3>A new setting for every look.</h3>
        <p>Upload your originals, save the batch, then generate your lifestyle images here.</p>
        <div className="empty-steps">
          <span>
            <Check size={15} />
            Product detail review
          </span>
          <span>
            <Check size={15} />
            Individual revisions
          </span>
          <span>
            <Check size={15} />
            ZIP export
          </span>
        </div>
      </div>
    );
  }
  const completed = tasks.filter((t) => !!t.output).length;
  const review = tasks.filter((t) => t.status === "review").length;
  const byId = new Map(sources.map((s) => [s.id, s]));

  return (
    <>
      <div className="batch-progress">
        <div>
          <span>
            {completed} of {tasks.length} generated
          </span>
          <span>
            {review > 0 ? `${review} need review` : running ? "Generating…" : "Ready when you are"}
          </span>
        </div>
        <Progress value={(completed / tasks.length) * 100} />
      </div>
      <div className="results-toolbar">
        <p>
          {selection.size
            ? `${selection.size} selected`
            : "Export includes all ready and approved results."}
        </p>
        {selection.size > 0 && (
          <button className="text-button" onClick={onClearSelection}>
            Clear selection
          </button>
        )}
        {onApproveAll && tasks.some((t) => t.status === "ready") && (
          <button className="text-button" onClick={onApproveAll}>
            <Check size={13} /> Approve all ready (
            {tasks.filter((t) => t.status === "ready").length})
          </button>
        )}
      </div>
      <div className="image-grid results-grid">
        {tasks.slice(0, limit).map((t) => {
          const s = byId.get(t.source);
          const eligible = t.status === "ready" || t.status === "approved";
          return (
            <article className={`image-card result-card ${t.status}`} key={t.id}>
              <button
                className="photo-frame result-photo"
                disabled={!t.output}
                onClick={() => onOpen(t)}
              >
                {t.output ? (
                  <img
                    src={outputUrl(t)}
                    alt={`AI result for ${s?.name}, card ${t.card}`}
                    loading="lazy"
                  />
                ) : (
                  <div className="generation-placeholder">
                    {t.status === "processing" ? (
                      <LoaderCircle className="spinning" size={28} />
                    ) : (
                      <FileImage size={26} />
                    )}
                    <span>
                      {t.status === "processing"
                        ? "Creating your image"
                        : t.status === "failed"
                          ? "Generation failed"
                          : "In the queue"}
                    </span>
                  </div>
                )}
                <span className={`status-pill ${t.status}`}>
                  {STATUS_LABEL[t.status] ?? t.status}
                </span>
                {t.output && (
                  <span className="zoom">
                    <ZoomIn size={17} />
                  </span>
                )}
              </button>
              <div className="image-info">
                <strong title={s?.name}>{s?.name}</strong>
                <span>{cardLabel(mode, t.card)}</span>
                {t.error && <span className="image-error">{t.error}</span>}
                {t.status === "failed" && (
                  <button className="text-button" onClick={() => onRetryTask(t)}>
                    <RotateCcw size={13} /> Retry this image
                  </button>
                )}
                {eligible && (
                  <label className="export-select">
                    <Checkbox
                      checked={selection.has(t.id)}
                      onCheckedChange={(v) => onSelect(t.id, v === true)}
                      aria-label={`Export ${s?.name} card ${t.card}`}
                    />
                    Select for ZIP
                  </label>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {tasks.length > limit && (
        <div className="show-more">
          <span>{tasks.length - limit} more not shown</span>
          <button className="secondary" onClick={() => setLimit((l) => l + PAGE * 2)}>
            Show more
          </button>
          <button className="text-button" onClick={() => setLimit(Number.MAX_SAFE_INTEGER)}>
            Show all
          </button>
        </div>
      )}
    </>
  );
}
