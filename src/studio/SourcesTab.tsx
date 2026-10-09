import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, ChevronDown, FolderOpen, Upload, X } from "lucide-react";
import { filesFromDrop, filesFromInput, type PickedFile } from "@/lib/files";
import type { SkillInfo, Source } from "@shared/types";
import Picker from "./Picker";
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
  onRoles,
  onBatchName,
  skills = [],
  moodBoardHidden = false,
  moodBoardTitle,
  canAssignSkill = false,
  onAssignSkill,
}: {
  batchOpen: boolean;
  config: Config;
  sources: Source[];
  pending: Pending[];
  uploading: boolean;
  batchName: string;
  sourceUrl: (id: string) => string;
  onFiles: (files: PickedFile[], root?: string | null) => void;
  onRemove: (url: string) => void;
  onRole: (url: string, role: "lead" | "supporting") => void;
  onRoles: (urls: string[], role: "lead" | "supporting") => void;
  /** Skills offered per photo in a saved Zaid creative direction batch. */
  skills?: SkillInfo[];
  /** The Mood board entry is hidden: it is not offered for assignment. */
  moodBoardHidden?: boolean;
  moodBoardTitle?: string;
  canAssignSkill?: boolean;
  onAssignSkill?: (ids: string[], skill: string | null) => Promise<void>;
  onBatchName: (name: string) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const PAGE = 48;
  const [limit, setLimit] = useState(PAGE);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggleFolder = (dir: string) =>
    setCollapsed((c) => {
      const n = new Set(c);
      if (n.has(dir)) n.delete(dir);
      else n.add(dir);
      return n;
    });
  const NO_FOLDER = "Loose photos";
  const dirOf = (name: string) => name.split("/").slice(0, -1).join("/") || NO_FOLDER;
  /** Items grouped by folder, folders in name order, loose photos last, files in name order. */
  function groupBy<T>(items: T[], name: (t: T) => string): [string, T[]][] {
    const map = new Map<string, T[]>();
    for (const it of items) {
      const d = dirOf(name(it));
      map.set(d, [...(map.get(d) ?? []), it]);
    }
    const compare = new Intl.Collator(undefined, { numeric: true }).compare;
    return [...map.entries()]
      .sort(([a], [b]) => (a === NO_FOLDER ? 1 : b === NO_FOLDER ? -1 : compare(a, b)))
      .map(([d, list]) => [d, [...list].sort((x, y) => compare(name(x), name(y)))]);
  }
  const visiblePending = pending.slice(0, limit);
  const pendingGroups = groupBy(visiblePending, (p) => p.name);
  const sourceGroups = groupBy(sources.slice(0, limit), (s) => s.name);
  // Saved batch, Zaid creative direction: pick photos and send them to another skill.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [assignTo, setAssignTo] = useState(moodBoardHidden ? (skills[0]?.id ?? "zaid") : "zaid");
  const [assigning, setAssigning] = useState(false);
  const skillChoices = [...(moodBoardHidden ? [] : ["zaid"]), ...skills.map((s) => s.id)];
  const skillTitle = (id: string | null | undefined) =>
    !id || id === "zaid"
      ? (moodBoardTitle ?? "Mood board")
      : (skills.find((s) => s.id === id)?.title ?? id);
  async function assignPicked() {
    if (!onAssignSkill || !picked.size) return;
    setAssigning(true);
    try {
      await onAssignSkill([...picked], assignTo === "zaid" ? null : assignTo);
      toast.success(
        `${picked.size} photo${picked.size === 1 ? "" : "s"} now use ${skillTitle(assignTo)}.`,
      );
      setPicked(new Set());
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAssigning(false);
    }
  }
  const visibleSources = sources.slice(0, limit);
  const hiddenCount = batchOpen
    ? sources.length - visibleSources.length
    : pending.length - visiblePending.length;
  const leads = pending.filter((p) => p.role === "lead").length;
  // Zaid creative direction: the N key clears every selected photo (nothing selected for generation).
  const clearAll = config.mode === "7" && !batchOpen && !uploading && leads > 0;
  useEffect(() => {
    if (!clearAll) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== "n" && e.key !== "N") return;
      e.preventDefault();
      onRoles(
        pending.map((p) => p.url),
        "supporting",
      );
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clearAll, pending, onRoles]);
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
              onFiles(filesFromInput(e.target.files).files);
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
              const { files, root } = filesFromInput(e.target.files);
              onFiles(files, root);
              e.target.value = "";
              if (!files.length) return;
              // The browser's folder dialog returns one folder at a time; chain picks in one click each.
              const first = files[0].path.split("/")[0];
              const folders = new Set(files.map((f) => f.path.split("/")[0])).size;
              toast(folders > 1 ? `${folders} folders added.` : `Folder "${first}" added.`, {
                description: "Add another folder to the same batch?",
                duration: 8000,
                action: {
                  label: "Add another folder",
                  onClick: () => folderInput.current?.click(),
                },
              });
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
              Folder names are kept in the export. To add many product folders at once, pick the
              folder that contains them, or drag them all in together. Up to 12 MB per image.
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
                <FolderOpen size={16} /> Upload folders
              </button>
            </div>
          </div>
          {pending.length > 0 && (
            <div className="batch-name">
              <label htmlFor="batch-name">Batch name</label>
              <input
                id="batch-name"
                placeholder="Spring collection"
                value={batchName}
                disabled={uploading}
                onChange={(e) => onBatchName(e.target.value)}
              />
              <span>
                {pending.length} originals
                {folders.size
                  ? ` in ${folders.size} folder${folders.size > 1 ? "s" : ""}`
                  : ""} · {leads} selected · {expected} AI results
              </span>
            </div>
          )}
        </>
      )}
      {!batchOpen && pending.length > 0 && (
        <div className="selection-bar">
          <span>
            <strong>{leads}</strong> of {pending.length} photos selected for generation
          </span>
          <div className="selection-actions">
            <button
              className="text-button"
              disabled={uploading || leads === pending.length}
              onClick={() =>
                onRoles(
                  pending.map((p) => p.url),
                  "lead",
                )
              }
            >
              Select all
            </button>
            <button
              className="text-button"
              disabled={uploading || leads === 0}
              onClick={() =>
                onRoles(
                  pending.map((p) => p.url),
                  "supporting",
                )
              }
            >
              Clear{config.mode === "7" && <kbd className="key-hint">N</kbd>}
            </button>
          </div>
        </div>
      )}
      {batchOpen && canAssignSkill && (
        <div className="selection-bar skill-assign">
          <span>
            <strong>{picked.size}</strong> of {sources.length} photos selected
          </span>
          <div className="selection-actions">
            <button
              className="text-button"
              disabled={assigning || picked.size === sources.length}
              onClick={() => setPicked(new Set(sources.map((s) => s.id)))}
            >
              Select all
            </button>
            <button
              className="text-button"
              disabled={assigning || picked.size === 0}
              onClick={() => setPicked(new Set())}
            >
              Clear
            </button>
            <Picker
              value={assignTo}
              label="Skill for the selected photos"
              disabled={assigning}
              items={skillChoices}
              render={skillTitle}
              onChange={setAssignTo}
            />
            <button
              type="button"
              className="primary"
              disabled={assigning || picked.size === 0}
              onClick={() => void assignPicked()}
            >
              Use this skill
            </button>
          </div>
        </div>
      )}
      {batchOpen
        ? sourceGroups.map(([dir, list]) => (
            <section className="folder-group" key={dir}>
              {sourceGroups.length > 1 || dir !== NO_FOLDER ? (
                <header className="folder-head">
                  <button type="button" className="folder-toggle" onClick={() => toggleFolder(dir)}>
                    <ChevronDown size={15} className={collapsed.has(dir) ? "closed" : ""} />
                    <FolderOpen size={15} />
                    <strong title={dir}>{dir}</strong>
                    <span>
                      {list.length} photo{list.length === 1 ? "" : "s"} ·{" "}
                      {list.filter((x) => x.role !== "supporting").length} generated
                    </span>
                  </button>
                </header>
              ) : null}
              {!collapsed.has(dir) && (
                <div className="image-grid">
                  {list.map((s) => (
                    <article
                      className={`image-card ${s.role === "supporting" ? "skipped" : ""}`}
                      key={s.id}
                    >
                      <div className="photo-frame">
                        <img src={sourceUrl(s.id)} alt={s.name} loading="lazy" />
                        <span className="image-label">ORIGINAL</span>
                        {canAssignSkill && (
                          <label className="select-box" title="Select this photo">
                            <input
                              type="checkbox"
                              checked={picked.has(s.id)}
                              onChange={(e) =>
                                setPicked((p) => {
                                  const n = new Set(p);
                                  if (e.target.checked) n.add(s.id);
                                  else n.delete(s.id);
                                  return n;
                                })
                              }
                            />
                            <span>
                              <Check size={14} />
                            </span>
                          </label>
                        )}
                      </div>
                      <div className="image-info">
                        <strong title={s.name}>{s.name.split("/").pop()}</strong>
                        <span>
                          {s.role === "supporting" ? "Kept original only" : "Generated"}
                          {canAssignSkill && ` · ${skillTitle(s.skill ?? config.skill)}`}
                        </span>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          ))
        : pendingGroups.map(([dir, list]) => {
            const urls = list.map((p) => p.url);
            const picked = list.filter((p) => p.role === "lead").length;
            const open = !collapsed.has(dir);
            return (
              <section className="folder-group" key={dir}>
                <header className="folder-head">
                  <button type="button" className="folder-toggle" onClick={() => toggleFolder(dir)}>
                    <ChevronDown size={15} className={open ? "" : "closed"} />
                    <FolderOpen size={15} />
                    <strong title={dir}>{dir}</strong>
                    <span>
                      {picked} of {list.length} selected
                    </span>
                  </button>
                  <div className="selection-actions">
                    <button
                      className="text-button"
                      disabled={uploading || picked === list.length}
                      onClick={() => onRoles(urls, "lead")}
                    >
                      All
                    </button>
                    <button
                      className="text-button"
                      disabled={uploading || picked === 0}
                      onClick={() => onRoles(urls, "supporting")}
                    >
                      None
                    </button>
                  </div>
                </header>
                {open && (
                  <div className="image-grid">
                    {list.map((p) => {
                      const on = p.role === "lead";
                      return (
                        <article className={`image-card ${on ? "" : "skipped"}`} key={p.url}>
                          <div className="photo-frame">
                            <img src={p.url} alt={p.name} />
                            <label
                              className="select-box"
                              title={on ? "Selected for generation" : "Not generated"}
                            >
                              <input
                                type="checkbox"
                                checked={on}
                                disabled={uploading}
                                onChange={(e) =>
                                  onRole(p.url, e.target.checked ? "lead" : "supporting")
                                }
                              />
                              <span>{on && <Check size={14} />}</span>
                            </label>
                            <button
                              className="remove-image"
                              aria-label={`Remove ${p.name}`}
                              disabled={uploading}
                              onClick={() => onRemove(p.url)}
                            >
                              <X size={14} />
                            </button>
                            <span className="image-label">{on ? "GENERATE" : "ORIGINAL ONLY"}</span>
                          </div>
                          <div className="image-info">
                            <strong title={p.name}>{p.name.split("/").pop()}</strong>
                            <span>
                              {on ? "Selected for generation" : "Kept in export, not generated"}
                            </span>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
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
