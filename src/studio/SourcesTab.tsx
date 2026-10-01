import { useRef, useState } from "react";
import { FolderOpen, Upload, X } from "lucide-react";
import Picker from "./Picker";
import { filesFromDrop, filesFromInput, type PickedFile } from "@/lib/files";
import type { Source } from "@shared/types";
import { cardsPerSource, type Config } from "@shared/config";

export interface Pending {
  file: File;
  /** Relative path inside the batch, e.g. `Denim/MAX_001.jpg` for folder uploads. */
  name: string;
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
  onFiles: (files: PickedFile[]) => void;
  onRemove: (url: string) => void;
  onRole: (url: string, role: "lead" | "supporting") => void;
  onBatchName: (name: string) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const PAGE = 48;
  const [limit, setLimit] = useState(PAGE);
  const groups = new Map<string, number>();
  for (const p of pending) {
    const dir = p.name.split("/").slice(0, -1).join("/") || "(no folder)";
    groups.set(dir, (groups.get(dir) ?? 0) + 1);
  }
  const visiblePending = pending.slice(0, limit);
  const visibleSources = sources.slice(0, limit);
  const hiddenCount = batchOpen
    ? sources.length - visibleSources.length
    : pending.length - visiblePending.length;
  const leads = pending.filter((p) => p.role === "lead").length;
  const expected = leads * cardsPerSource(config);
  const folders = new Set(
    pending.map((p) => p.name.split("/").slice(0, -1).join("/")).filter(Boolean),
  );

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
              onFiles(filesFromInput(e.target.files));
              e.target.value = "";
            }}
          />
          <input
            ref={folderInput}
            type="file"
            hidden
            // @ts-expect-error non-standard attribute understood by Chromium, Safari and Firefox
            webkitdirectory=""
            directory=""
            multiple
            onChange={(e) => {
              onFiles(filesFromInput(e.target.files));
              e.target.value = "";
            }}
          />
          <div
            className={`dropzone ${pending.length ? "compact" : ""}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (uploading) return;
              void filesFromDrop(e.dataTransfer).then(onFiles);
            }}
          >
            <div className="upload-icon">
              <Upload size={28} />
            </div>
            <h3>
              {pending.length
                ? "Add more photographs or folders"
                : "Drop your collection or a whole folder here"}
            </h3>
            <p>
              Folders are read recursively and their names are kept in the export. Up to 12 MB per
              image.
            </p>
            <div className="footer-actions">
              <button
                className="secondary"
                disabled={uploading}
                onClick={() => fileInput.current?.click()}
              >
                <Upload size={16} /> Browse images
              </button>
              <button
                className="secondary"
                disabled={uploading}
                onClick={() => folderInput.current?.click()}
              >
                <FolderOpen size={16} /> Upload folder
              </button>
            </div>
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
                {pending.length} originals
                {folders.size
                  ? ` in ${folders.size} folder${folders.size > 1 ? "s" : ""}`
                  : ""} · {expected} AI results
              </span>
            </div>
          )}
        </>
      )}
      {!batchOpen && groups.size > 1 && (
        <div className="folder-summary">
          <strong>{groups.size} folders</strong>
          <ul>
            {[...groups.entries()].slice(0, 200).map(([dir, n]) => (
              <li key={dir}>
                <span title={dir}>{dir}</span>
                <small>{n}</small>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="image-grid">
        {batchOpen
          ? visibleSources.map((s) => (
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
          : visiblePending.map((p) => (
              <article className="image-card" key={p.url}>
                <div className="photo-frame">
                  <img src={p.url} alt={p.name} />
                  <button
                    className="remove-image"
                    aria-label={`Remove ${p.name}`}
                    disabled={uploading}
                    onClick={() => onRemove(p.url)}
                  >
                    <X size={14} />
                  </button>
                  <span className="image-label">ORIGINAL</span>
                </div>
                <div className="image-info">
                  <strong title={p.name}>{p.name}</strong>
                  <Picker
                    label={`Role for ${p.name}`}
                    value={p.role}
                    disabled={uploading}
                    items={["lead", "supporting"]}
                    render={(v) => (v === "lead" ? "Generate" : "Keep original only")}
                    onChange={(v) => onRole(p.url, v as Pending["role"])}
                  />
                </div>
              </article>
            ))}
      </div>
      {hiddenCount > 0 && (
        <div className="show-more">
          <span>{hiddenCount} more not shown</span>
          <button className="secondary" onClick={() => setLimit((l) => l + PAGE * 2)}>
            Show more
          </button>
          <button className="text-button" onClick={() => setLimit(Number.MAX_SAFE_INTEGER)}>
            Show all
          </button>
        </div>
      )}
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
