import { useState } from "react";
import { Check, LoaderCircle, RefreshCw, ScanLine } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { QA, Source, Task } from "@shared/types";
import Zoomable from "./Zoomable";

export default function ReviewDialog({
  task,
  source,
  busy,
  originalUrl,
  resultUrl,
  onClose,
  onRevise,
  onApprove,
}: {
  task: Task | null;
  source: Source | null;
  busy: boolean;
  originalUrl: string;
  resultUrl: string;
  onClose: () => void;
  onRevise: (edit: string) => Promise<void>;
  onApprove: () => Promise<void>;
}) {
  const [showOriginal, setShowOriginal] = useState(false);
  const [edit, setEdit] = useState("");
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

  return (
    <Dialog
      open={!!task}
      onOpenChange={(open) => {
        if (!open) {
          setEdit("");
          setShowOriginal(false);
          onClose();
        }
      }}
    >
      <DialogContent className="review-dialog">
        <DialogHeader>
          <DialogTitle>{source?.name}</DialogTitle>
          <DialogDescription>
            Compare with the original. Revise this image without rerunning the batch.
          </DialogDescription>
        </DialogHeader>
        <div className="review-layout">
          <div>
            <div className="comparison-bar">
              <button
                className={!showOriginal ? "chosen" : ""}
                onClick={() => setShowOriginal(false)}
              >
                AI result
              </button>
              <button
                className={showOriginal ? "chosen" : ""}
                onClick={() => setShowOriginal(true)}
              >
                Original
              </button>
            </div>
            <div className="review-photo">
              {task && (
                <Zoomable
                  src={showOriginal ? originalUrl : resultUrl}
                  alt={showOriginal ? "Original product photo" : "Generated product photo"}
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
                <p className="qa-notes">{qa.notes}</p>
              </>
            )}
            {brief && (
              <div className="brief-box">
                <strong>Editorial brief</strong>
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
            <p className="quality-note">
              Automatic checks are estimates. Compare fabric, colour, fit and face against the
              original.
            </p>
            <label className="field-label" htmlFor="revision">
              Edit this result
            </label>
            <textarea
              id="revision"
              rows={5}
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
              disabled={busy || !task || !["ready", "review"].includes(task.status)}
            >
              <Check size={17} />
              {task?.status === "approved" ? "Approved" : "Approve for export"}
            </button>
            <span className="revision-note">
              Each revision uses credits. Your original stays untouched.
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
