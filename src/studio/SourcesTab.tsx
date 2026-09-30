import { useRef } from "react";
import { Upload, X } from "lucide-react";
import Picker from "./Picker";
import type { Source } from "@shared/types";
import type { Config } from "@shared/config";

export interface Pending {
  file: File;
  url: string;
  role: "lead" | "supporting";
}

export default function SourcesTab({
  batchOpen,
  config,
  sources,
  pending,
  uploading,
  batchName,
  sourceUrl,
  onFiles,
  onRemove,
  onRole,
  onBatchName,
}: {
  batchOpen: boolean;
  config: Config;
  sources: Source[];
  pending: Pending[];
  uploading: boolean;
  batchName: string;
  sourceUrl: (id: string) => string;
  onFiles: (files: FileList | null) => void;
  onRemove: (url: string) => void;
  onRole: (url: string, role: "lead" | "supporting") => void;
  onBatchName: (name: string) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const expected =
    config.mode === "1" ? pending.length * 6 : pending.filter((p) => p.role === "lead").length;

  return (
    <>
      {!batchOpen && (
        <>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            hidden
            onChange={(e) => {
              onFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <div
            className={`dropzone ${pending.length ? "compact" : ""}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (!uploading) onFiles(e.dataTransfer.files);
            }}
          >
            <div className="upload-icon">
              <Upload size={28} />
            </div>
            <h3>{pending.length ? "Add more photographs" : "Drop your collection here"}</h3>
            <p>Select multiple images at once. Up to 12 MB each.</p>
            <button
              className="secondary"
              disabled={uploading}
              onClick={() => fileInput.current?.click()}
            >
              Browse images
            </button>
          </div>
          {pending.length > 0 && (
            <div className="batch-name">
              <label htmlFor="batch-name">Batch name</label>
              <input
                id="batch-name"
                placeholder={`${config.category} collection`}
                value={batchName}
                disabled={uploading}
                onChange={(e) => onBatchName(e.target.value)}
              />
              <span>
                {pending.length} originals · {expected} AI results
              </span>
            </div>
          )}
        </>
      )}
      <div className="image-grid">
        {batchOpen
          ? sources.map((s) => (
              <article className="image-card" key={s.id}>
                <div className="photo-frame">
                  <img src={sourceUrl(s.id)} alt={s.name} loading="lazy" />
                  <span className="image-label">ORIGINAL</span>
                </div>
                <div className="image-info">
                  <strong title={s.name}>{s.name}</strong>
                  <span>
                    {s.role === "supporting" ? "Supporting · kept original" : "Product source"}
                  </span>
                </div>
              </article>
            ))
          : pending.map((p) => (
              <article className="image-card" key={p.url}>
                <div className="photo-frame">
                  <img src={p.url} alt={p.file.name} />
                  <button
                    className="remove-image"
                    aria-label={`Remove ${p.file.name}`}
                    disabled={uploading}
                    onClick={() => onRemove(p.url)}
                  >
                    <X size={14} />
                  </button>
                  <span className="image-label">ORIGINAL</span>
                </div>
                <div className="image-info">
                  <strong title={p.file.name}>{p.file.name}</strong>
                  {config.mode === "2" || config.mode === "3" ? (
                    <Picker
                      label={`Role for ${p.file.name}`}
                      value={p.role}
                      disabled={uploading}
                      items={["lead", "supporting"]}
                      onChange={(v) => onRole(p.url, v as Pending["role"])}
                    />
                  ) : (
                    <span>{(p.file.size / 1048576).toFixed(1)} MB</span>
                  )}
                </div>
              </article>
            ))}
      </div>
      {batchOpen && sources.length === 0 && (
        <div className="empty-results">
          <Upload size={28} />
          <h3>No originals in this batch</h3>
          <p>Create a new batch to upload your photographs.</p>
        </div>
      )}
    </>
  );
}
