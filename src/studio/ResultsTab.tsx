import { Check, FileImage, LoaderCircle, RotateCcw, ScanLine, ZoomIn } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { STATUS_LABEL } from "./constants";
import type { Source, Task } from "@shared/types";

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
}) {
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
      </div>
      <div className="image-grid results-grid">
        {tasks.map((t) => {
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
                <span>
                  {t.card === 6
                    ? "Fabric detail"
                    : mode === "1"
                      ? `Lifestyle ${t.card}`
                      : "Lifestyle image"}
                </span>
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
    </>
  );
}
