import { useMemo, useState } from "react";
import { Check, FileImage, LoaderCircle, Pencil, RotateCcw, ScanLine, ZoomIn } from "lucide-react";
import { productKey } from "@shared/naming";
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
  if (mode === "8") return `New model ${card}`;
  if (mode === "7") return `Zaid ${card}`;
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
  sourceUrl,
  onSelect,
  onClearSelection,
  onOpen,
  onRetryTask,
  onApproveAll,
  onApproveTask,
}: {
  tasks: Task[];
  sources: Source[];
  mode: string;
  running: boolean;
  selection: Set<string>;
  outputUrl: (t: Task) => string;
  /** Preview of the original photo, shown in the card until the AI result exists. */
  sourceUrl: (id: string) => string;
  onSelect: (id: string, on: boolean) => void;
  onClearSelection: () => void;
  onOpen: (t: Task) => void;
  onRetryTask: (t: Task) => void;
  onApproveAll?: () => void;
  onApproveTask?: (t: Task) => void;
}) {
  const PAGE = 60;
  const [limit, setLimit] = useState(PAGE);
  const [filter, setFilter] = useState<
    "all" | "review" | "ready" | "approved" | "failed" | "active"
  >("all");
  const byId = new Map(sources.map((s) => [s.id, s]));
  // Product sets (<id>_01, _02 ...) sit next to each other; a set of two or more gets a caption.
  const ordered = useMemo(() => {
    const keyOf = (t: Task) => productKey(byId.get(t.source)?.name ?? "");
    const nameOf = (t: Task) => byId.get(t.source)?.name ?? "";
    const list = [...tasks].sort(
      (a, b) =>
        keyOf(a).localeCompare(keyOf(b)) || nameOf(a).localeCompare(nameOf(b)) || a.card - b.card,
    );
    const sizes = new Map<string, number>();
    for (const t of list) sizes.set(keyOf(t), (sizes.get(keyOf(t)) ?? 0) + 1);
    return list.map((t) => ({ t, key: keyOf(t), setSize: sizes.get(keyOf(t)) ?? 1 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, sources]);
  const matches = (t: Task) =>
    filter === "all"
      ? true
      : filter === "active"
        ? ["queued", "processing", "finalizing"].includes(t.status)
        : t.status === filter;
  const visible = ordered.filter((x) => matches(x.t));
  const counts = {
    review: tasks.filter((t) => t.status === "review").length,
    ready: tasks.filter((t) => t.status === "ready").length,
    approved: tasks.filter((t) => t.status === "approved").length,
    failed: tasks.filter((t) => t.status === "failed").length,
    active: tasks.filter((t) => ["queued", "processing", "finalizing"].includes(t.status)).length,
  };
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
  const review = counts.review;

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
      <div className="filter-chips" role="tablist" aria-label="Filter results">
        {(
          [
            ["all", "All", tasks.length],
            ["review", "Needs review", counts.review],
            ["ready", "Ready", counts.ready],
            ["approved", "Approved", counts.approved],
            ["failed", "Failed", counts.failed],
            ["active", running ? "Generating" : "Waiting", counts.active],
          ] as const
        )
          .filter(([k, , n]) => k === "all" || n > 0)
          .map(([k, label, n]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={filter === k}
              className={`chip ${k} ${filter === k ? "on" : ""}`}
              onClick={() => setFilter(k)}
            >
              {label} <b>{n}</b>
            </button>
          ))}
      </div>
      <div className="image-grid results-grid">
        {visible.slice(0, limit).map(({ t, key, setSize }, i) => {
          const s = byId.get(t.source);
          const eligible = t.status === "ready" || t.status === "approved";
          const firstOfSet = setSize > 1 && (i === 0 || visible[i - 1].key !== key);
          return (
            <article
              className={`image-card result-card ${t.status} ${setSize > 1 ? "in-set" : ""}`}
              key={t.id}
              data-set={setSize > 1 ? key : undefined}
            >
              {firstOfSet && (
                <span className="set-caption" title="Images of one product generate as one shoot">
                  Set · {setSize}
                </span>
              )}
              <span
                className={`status-bar ${t.status === "queued" && !running ? "waiting" : t.status}`}
                aria-hidden="true"
              />
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
                  <div
                    className={`generation-placeholder ${t.status === "queued" && !running ? "waiting" : ""} ${t.status === "failed" ? "failed" : ""}`}
                  >
                    {s && (
                      <img
                        className="placeholder-source"
                        src={sourceUrl(s.id)}
                        alt={`Original photo ${s.name}`}
                        loading="lazy"
                      />
                    )}
                    <div className="placeholder-state">
                      {t.status === "processing" ? (
                        <LoaderCircle className="spinning" size={28} />
                      ) : t.status === "failed" ? (
                        <FileImage size={26} />
                      ) : null}
                      <span>
                        {t.status === "processing"
                          ? "Creating your image"
                          : t.status === "failed"
                            ? "Generation failed"
                            : running
                              ? "In the queue"
                              : "Original · not generated yet"}
                      </span>
                    </div>
                  </div>
                )}
                {t.output && (
                  <span className="zoom">
                    <ZoomIn size={17} />
                  </span>
                )}
              </button>
              {t.output && (
                <div className="card-actions">
                  {(t.status === "ready" || t.status === "review") && onApproveTask && (
                    <button type="button" onClick={() => onApproveTask(t)} title="Approve (A)">
                      <Check size={14} /> Approve
                    </button>
                  )}
                  <button type="button" onClick={() => onOpen(t)} title="Open review">
                    <Pencil size={14} /> Revise
                  </button>
                </div>
              )}
              <div className="image-info">
                <strong title={s?.name}>{s?.name}</strong>
                <span>
                  <i className={`status-text ${t.status}`}>
                    {t.status === "queued" && !running
                      ? "Waiting"
                      : (STATUS_LABEL[t.status] ?? t.status)}
                  </i>
                  {" · "}
                  {cardLabel(mode, t.card)}
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
      {visible.length > limit && (
        <div className="show-more">
          <span>{visible.length - limit} more not shown</span>
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
