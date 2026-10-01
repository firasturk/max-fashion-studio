import { useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, LoaderCircle, RefreshCw, ScanLine } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { QA, Source, Task } from "@shared/types";
import Zoomable from "./Zoomable";
import CompareSlider from "./CompareSlider";

/** One-click revision instructions; each appends to the edit box. */
const REVISION_PRESETS: { label: string; text: string }[] = [
  {
    label: "Fix hands",
    text: "Fix the hands and fingers: five natural fingers per hand, correct anatomy, no distortion.",
  },
  {
    label: "Match colour",
    text: "Match the garment colour, print and wash exactly to the original photo; no colour shift.",
  },
  {
    label: "Centre model",
    text: "Move the model to the exact horizontal centre of the frame with equal margins; keep everything else.",
  },
  {
    label: "Brighter",
    text: "Make the scene brighter with soft natural light; keep the garment colours accurate.",
  },
  {
    label: "Cleaner background",
    text: "Simplify the background: fewer objects, no readable text, softer depth of field.",
  },
  {
    label: "Full garment",
    text: "Show the full garment including the hem; nothing cropped or hidden.",
  },
  {
    label: "Same face",
    text: "Use exactly the same face, hair and skin tone as the reference model; no identity change.",
  },
  {
    label: "Less retouching",
    text: "Reduce skin smoothing: realistic pores, natural texture, no plastic look.",
  },
];

export default function ReviewDialog({
  task,
  source,
  busy,
  originalUrl,
  resultUrl,
  position,
  onClose,
  onRevise,
  onApprove,
  onPrev,
  onNext,
}: {
  task: Task | null;
  source: Source | null;
  busy: boolean;
  originalUrl: string;
  resultUrl: string;
  position?: { index: number; total: number };
  onClose: () => void;
  onRevise: (edit: string) => Promise<void>;
  onApprove: () => Promise<void>;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const [view, setView] = useState<"compare" | "result" | "original">("compare");
  const [edit, setEdit] = useState("");
  const editRef = useRef<HTMLTextAreaElement>(null);
  const qa = task?.qa ? (JSON.parse(task.qa) as QA) : null;
  const brief = task?.brief
    ? (JSON.parse(task.brief) as {
        scene: string;
        pose: string;
        light: string;
        faceMode: string;
        subject: string;
      })
    : null;
  const fabric = task?.card === 6;
  const canApprove = !!task && (task.status === "ready" || task.status === "review");

  // Keyboard: A approve, R revise, arrows navigate, 1/2/3 switch views. Ignored while typing.
  useEffect(() => {
    if (!task) return;
    const onKey = (e: KeyboardEvent) => {
      const typing =
        (e.target as HTMLElement)?.tagName === "TEXTAREA" ||
        (e.target as HTMLElement)?.tagName === "INPUT";
      if (typing) return;
      if (e.key === "ArrowLeft" && onPrev) onPrev();
      else if (e.key === "ArrowRight" && onNext) onNext();
      else if ((e.key === "a" || e.key === "A") && canApprove && !busy) void onApprove();
      else if (e.key === "r" || e.key === "R") editRef.current?.focus();
      else if (e.key === "1") setView("compare");
      else if (e.key === "2") setView("result");
      else if (e.key === "3") setView("original");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [task, onPrev, onNext, onApprove, canApprove, busy]);

  useEffect(() => setEdit(""), [task?.id]);

  return (
    <Dialog
      open={!!task}
      onOpenChange={(open) => {
        if (!open) {
          setEdit("");
          onClose();
        }
      }}
    >
      <DialogContent className="review-dialog">
        <DialogHeader>
          <DialogTitle>
            {source?.name}
            {position && (
              <span className="review-position">
                {position.index + 1} / {position.total}
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            Drag the slider to compare. Keys: ← → next image · A approve · R revise · 1/2/3 views.
          </DialogDescription>
        </DialogHeader>
        <div className="review-layout">
          <div>
            <div className="comparison-bar">
              <button
                className={view === "compare" ? "chosen" : ""}
                onClick={() => setView("compare")}
              >
                Compare
              </button>
              <button
                className={view === "result" ? "chosen" : ""}
                onClick={() => setView("result")}
              >
                AI result
              </button>
              <button
                className={view === "original" ? "chosen" : ""}
                onClick={() => setView("original")}
              >
                Original
              </button>
              <span className="nav-arrows">
                <button onClick={onPrev} disabled={!onPrev} aria-label="Previous image">
                  <ChevronLeft size={16} />
                </button>
                <button onClick={onNext} disabled={!onNext} aria-label="Next image">
                  <ChevronRight size={16} />
                </button>
              </span>
            </div>
            <div className="review-photo">
              {task && view === "compare" && (
                <CompareSlider
                  before={originalUrl}
                  after={resultUrl}
                  alt="Generated product photo"
                />
              )}
              {task && view !== "compare" && (
                <Zoomable
                  src={view === "original" ? originalUrl : resultUrl}
                  alt={view === "original" ? "Original product photo" : "Generated product photo"}
                  overlay={<div className="center-line" />}
                />
              )}
            </div>
          </div>
          <div className="revision-panel">
            <div className="qa-heading">
              <ScanLine size={18} />
              <strong>Image review</strong>
            </div>
            {qa && (
              <>
                <div className={`qa-item ${qa.centered ? "pass" : "warn"}`}>
                  <span>Model alignment</span>
                  <strong>
                    {fabric
                      ? "Not applicable"
                      : !qa.automated
                        ? "Manual check"
                        : qa.found
                          ? `${Number(qa.offset).toFixed(1)}% off centre`
                          : "Needs manual review"}
                  </strong>
                </div>
                <div className={`qa-item ${qa.productConcern ? "warn" : "pass"}`}>
                  <span>Product fidelity</span>
                  <strong>
                    {!qa.automated
                      ? "Manual check"
                      : qa.productConcern
                        ? "Check differences"
                        : "No obvious differences"}
                  </strong>
                </div>
                {qa.automated &&
                  qa.sameFace !== undefined &&
                  task &&
                  task.card > 1 &&
                  task.card < 6 && (
                    <div className={`qa-item ${qa.sameFace ? "pass" : "warn"}`}>
                      <span>Same face as card 1</span>
                      <strong>{qa.sameFace ? "Yes" : "Different face"}</strong>
                    </div>
                  )}
                <p className="qa-notes">{qa.notes}</p>
              </>
            )}
            {brief && (
              <div className="brief-box">
                <strong>Skill brief</strong>
                <span>
                  {brief.subject} · {brief.faceMode.replace("_", " ").toLowerCase()}
                </span>
                <span>Scene: {brief.scene}</span>
                <span>Pose: {brief.pose}</span>
                <span>Light: {brief.light}</span>
              </div>
            )}
            {task?.prompt && (
              <details className="prompt-details">
                <summary>Prompt used</summary>
                <pre>{task.prompt}</pre>
              </details>
            )}
            {task?.error && <p className="image-error">{task.error}</p>}
            {task && task.cost > 0 && (
              <p className="quality-note">Spent on this image so far ≈ ${task.cost.toFixed(2)}.</p>
            )}

            <label className="field-label" htmlFor="revision">
              Edit this result
            </label>
            <div className="preset-chips">
              {REVISION_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  disabled={busy}
                  onClick={() => setEdit((e) => (e ? `${e} ${p.text}` : p.text))}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <textarea
              id="revision"
              ref={editRef}
              rows={4}
              placeholder="e.g. Keep the outfit unchanged. Move the model to the exact centre and use a brighter urban background."
              value={edit}
              onChange={(e) => setEdit(e.target.value)}
              disabled={busy}
            />
            <button
              className="primary"
              onClick={() => onRevise(edit).then(() => setEdit(""))}
              disabled={busy || !edit.trim() || task?.status === "processing"}
            >
              {busy ? <LoaderCircle className="spinning" size={17} /> : <RefreshCw size={17} />}
              Generate revision
            </button>
            <button
              className="secondary"
              onClick={() => void onApprove()}
              disabled={busy || !canApprove}
            >
              <Check size={17} />
              {task?.status === "approved" ? "Approved" : "Approve for export (A)"}
            </button>
            <span className="revision-note">
              Each revision is one more paid generation. Your original stays untouched.
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
