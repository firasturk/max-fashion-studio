import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { get, post } from "@/api";
import type { SkillInfo } from "@shared/types";
import VideoDialog from "./VideoDialog";
import { skillTone } from "./tone";

interface Item {
  id: string;
  batch: string;
  source: string;
  status: "ready" | "review" | "approved";
  qa: string | null;
  output: string;
  name: string;
  batch_name: string;
  skill: string | null;
}

const QUICK_NOTES = [
  "Place the model in the centre of the frame.",
  "Match the garment exactly to the original photo: colour, print and text.",
  "Keep the scene, try a different pose.",
];

const result = (i: Item) =>
  `/api/studio/file?batch=${i.batch}&id=${i.id}&kind=result&v=${i.output.split("/").at(-1)}`;
/** Small copies: the grid and the viewer never load the multi-megabyte file itself. */
const thumb = (i: Item) => `${result(i)}&w=480`;
const large = (i: Item) => `${result(i)}&w=1400`;
const original = (i: Item) => `/api/studio/file?batch=${i.batch}&id=${i.source}&kind=reference`;
const sku = (name: string) => (name.split("/").at(-1) ?? name).replace(/\.[a-z0-9]+$/i, "");

/** What the automatic check found, in the reviewer's words. */
function findings(i: Item): string[] {
  if (i.status === "ready") return [];
  try {
    const q = JSON.parse(i.qa ?? "{}") as {
      productConcern?: boolean;
      centered?: boolean;
      sameFace?: boolean;
      count?: number;
      notes?: string;
    };
    const out: string[] = [];
    if (q.productConcern) out.push("Check the product against the original");
    if (q.centered === false) out.push("Not centred");
    if (q.sameFace === false) out.push("Face differs from the set");
    if ((q.count ?? 1) > 1) out.push("More than one person");
    return out.length ? out : ["Needs a look"];
  } catch {
    return ["Needs a look"];
  }
}

/** One decision per image, across every batch: approve, or send back with a note. */
export default function ReviewPage({
  skills,
  onOpenBatch,
  onCount,
  onVideo,
  start = "all",
}: {
  /** The tab to open on, when the page is reached from Ask the studio. */
  start?: "all" | "review" | "approved";
  skills: SkillInfo[];
  /** Opens the Video page: after clips were started, or to connect the video engine. */
  onVideo: () => void;
  onOpenBatch: (id: string) => void;
  onCount: (n: number) => void;
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [filter, setFilter] = useState<"all" | "review" | "ready" | "approved">(start);
  /** Approved images are fetched when their tab is first opened; null means not loaded. */
  const [approved, setApproved] = useState<Item[] | null>(null);
  const [video, setVideo] = useState<Item[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [limit, setLimit] = useState(48);

  const load = useCallback(async () => {
    try {
      const r = await get<{ items: Item[] }>("/api/studio/review");
      setItems(r.items);
      onCount(r.items.length);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load the review list.");
    }
  }, [onCount]);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    if (filter !== "approved" || approved !== null) return;
    get<{ items: Item[] }>("/api/studio/review?status=approved")
      .then((r) => setApproved(r.items))
      .catch(() => setApproved([]));
  }, [filter, approved]);

  const shown = useMemo(
    () =>
      filter === "approved"
        ? (approved ?? [])
        : (items ?? []).filter((i) => filter === "all" || i.status === filter),
    [items, approved, filter],
  );
  const open = shown.find((i) => i.id === openId) ?? null;
  const count = (s: "ready" | "review") => (items ?? []).filter((i) => i.status === s).length;
  const title = (id: string | null) => skills.find((s) => s.id === id)?.title ?? id ?? "";

  const drop = useCallback(
    (ids: string[]) => {
      setItems((list) => {
        const next = (list ?? []).filter((i) => !ids.includes(i.id));
        onCount(next.length);
        return next;
      });
      setApproved((list) => (list ? list.filter((i) => !ids.includes(i.id)) : list));
      setPicked((p) => new Set([...p].filter((id) => !ids.includes(id))));
    },
    [onCount],
  );

  const step = useCallback(
    (d: number) => {
      if (!shown.length) return setOpenId(null);
      const k = shown.findIndex((i) => i.id === openId);
      setNote(null);
      setOpenId(shown[(k + d + shown.length) % shown.length].id);
    },
    [shown, openId],
  );

  const approve = useCallback(
    async (list: Item[]) => {
      if (!list.length || busy) return;
      setBusy(true);
      const done: string[] = [];
      try {
        for (const i of list) {
          await post("/api/studio/approve", { batch: i.batch, id: i.id });
          done.push(i.id);
        }
        toast.success(
          list.length === 1 ? `Approved ${sku(list[0].name)}` : `Approved ${done.length} images`,
        );
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Approval failed.");
      } finally {
        if (open && done.includes(open.id)) {
          const rest = shown.filter((i) => !done.includes(i.id));
          const k = shown.findIndex((i) => i.id === open.id);
          setOpenId(rest.length ? rest[Math.min(k, rest.length - 1)].id : null);
        }
        drop(done);
        if (done.length) setApproved(null);
        setBusy(false);
      }
    },
    [busy, drop, open, shown],
  );

  const revise = useCallback(
    async (i: Item, edit: string) => {
      if (!edit.trim() || busy) return;
      setBusy(true);
      try {
        await post("/api/studio/revise", { batch: i.batch, id: i.id, edit: edit.trim() });
        toast.success(`Sent back ${sku(i.name)} with your note`);
        const rest = shown.filter((x) => x.id !== i.id);
        const k = shown.findIndex((x) => x.id === i.id);
        setOpenId(rest.length ? rest[Math.min(k, rest.length - 1)].id : null);
        setNote(null);
        drop([i.id]);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not send it back.");
      } finally {
        setBusy(false);
      }
    },
    [busy, drop, shown],
  );

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).matches?.("input,textarea,select");
      if (video) return void (e.key === "Escape" && setVideo(null));
      if (e.key === "Escape") return note !== null ? setNote(null) : setOpenId(null);
      if (!open || typing || e.metaKey || e.ctrlKey) return;
      const k = e.key.toLowerCase();
      if (k === "a" && open.status !== "approved") void approve([open]);
      else if (k === "v") setVideo([open]);
      else if (k === "e") {
        e.preventDefault();
        setNote("");
      } else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open, note, video, approve, step]);

  const selected = shown.filter((i) => picked.has(i.id));
  return (
    <div className="nx nx-enter">
      <div className="nx-head">
        <div>
          <h1>Review</h1>
          <p>
            One decision per image, across all your batches. The studio already checked product,
            face and centring; you only confirm.
          </p>
        </div>
        <div className="nx-right">
          <button
            className="nx-btn"
            disabled={!count("ready") || busy}
            onClick={() => void approve((items ?? []).filter((i) => i.status === "ready"))}
          >
            Approve all that passed QC
          </button>
        </div>
      </div>
      <div className="nx-row">
        <div className="nx-seg" role="group" aria-label="Filter">
          {(
            [
              ["all", "To decide", (items ?? []).length],
              ["review", "Needs a look", count("review")],
              ["ready", "Passed QC", count("ready")],
              ["approved", "Approved", approved ? approved.length : ""],
            ] as const
          ).map(([k, label, n]) => (
            <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>
              {label} <span className="nx-mono">{n}</span>
            </button>
          ))}
        </div>
        <span className="nx-muted nx-keys">
          Open an image, then <kbd>A</kbd> approve <kbd>E</kbd> send back <kbd>V</kbd> video
        </span>
      </div>
      {items === null || (filter === "approved" && approved === null) ? null : !shown.length ? (
        <div className="nx-empty">
          <b>{filter === "approved" ? "No approved images yet" : "Nothing waiting for you"}</b>
          {filter === "approved"
            ? "Images you approve are kept here, ready to turn into clips."
            : "Finished images appear here as soon as a batch produces them."}
        </div>
      ) : (
        <>
          <div className="nx-grid nx-stagger">
            {shown.slice(0, limit).map((i) => (
              <article className={`nx-card ${picked.has(i.id) ? "nx-sel" : ""}`} key={i.id}>
                <button
                  className="nx-pic"
                  onClick={() => setOpenId(i.id)}
                  aria-label={`Open ${sku(i.name)}`}
                >
                  <img
                    src={thumb(i)}
                    alt={`Result for ${sku(i.name)}`}
                    loading="lazy"
                    decoding="async"
                  />
                </button>
                <button
                  className="nx-tick"
                  aria-pressed={picked.has(i.id)}
                  aria-label={`Select ${sku(i.name)}`}
                  onClick={() =>
                    setPicked((p) => {
                      const n = new Set(p);
                      if (n.has(i.id)) n.delete(i.id);
                      else n.add(i.id);
                      return n;
                    })
                  }
                >
                  {picked.has(i.id) ? "✓" : ""}
                </button>
                <span className="nx-state">
                  {i.status === "approved" ? (
                    <span className="nx-chip nx-ok">Approved</span>
                  ) : i.status === "ready" ? (
                    <span className="nx-chip nx-ok">Passed QC</span>
                  ) : (
                    <span className="nx-chip nx-warn">Needs a look</span>
                  )}
                </span>
                <div className="nx-meta">
                  <span className="nx-mono nx-sku">{sku(i.name)}</span>
                  <span className={skillTone(i.skill)}>{title(i.skill)}</span>
                </div>
              </article>
            ))}
          </div>
          {shown.length > limit && (
            <button className="nx-btn nx-more-btn" onClick={() => setLimit((n) => n + 48)}>
              Show 48 more of {shown.length - limit}
            </button>
          )}
        </>
      )}
      {selected.length > 0 && !open && !video && (
        <div className="nx-bulk">
          <span>
            <b>{selected.length}</b> selected
          </span>
          {filter !== "approved" && (
            <button
              className="nx-btn nx-primary"
              disabled={busy}
              onClick={() => void approve(selected)}
            >
              Approve
            </button>
          )}
          <button
            className={`nx-btn ${filter === "approved" ? "nx-primary" : ""}`}
            onClick={() => setVideo(selected)}
          >
            Make video
          </button>
          <button className="nx-btn" onClick={() => setPicked(new Set())}>
            Clear
          </button>
        </div>
      )}
      {open && (
        <div className="nx-scrim" onClick={(e) => e.target === e.currentTarget && setOpenId(null)}>
          <section
            className="nx-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={`Review ${sku(open.name)}`}
          >
            <header>
              <h2 className="nx-mono">{sku(open.name)}</h2>
              <span className={skillTone(open.skill)}>{title(open.skill)}</span>
              <span className="nx-muted">{open.batch_name}</span>
              <span className="nx-right">
                <button className="nx-btn nx-sm" onClick={() => step(-1)}>
                  Previous
                </button>
                <button className="nx-btn nx-sm" onClick={() => step(1)}>
                  Next
                </button>
                <button className="nx-btn nx-sm nx-quiet" onClick={() => setOpenId(null)}>
                  Close
                </button>
              </span>
            </header>
            <div className="nx-pair">
              <figure>
                <img src={original(open)} alt="Original studio photo" />
                <figcaption className="nx-chip">Original</figcaption>
              </figure>
              <figure>
                <img src={large(open)} alt="Generated result" />
                <figcaption className="nx-chip">Result</figcaption>
              </figure>
            </div>
            <div className="nx-body">
              <div className="nx-row">
                {open.status === "approved" ? (
                  <span className="nx-chip nx-ok">Approved</span>
                ) : findings(open).length ? (
                  findings(open).map((f) => (
                    <span className="nx-chip nx-warn" key={f}>
                      {f}
                    </span>
                  ))
                ) : (
                  <span className="nx-chip nx-ok">Product, face and centring passed</span>
                )}
              </div>
              {note === null ? (
                <div className="nx-row">
                  {open.status !== "approved" && (
                    <button
                      className="nx-btn nx-primary"
                      disabled={busy}
                      onClick={() => void approve([open])}
                    >
                      Approve <kbd>A</kbd>
                    </button>
                  )}
                  <button
                    className={`nx-btn ${open.status === "approved" ? "nx-primary" : ""}`}
                    onClick={() => setVideo([open])}
                  >
                    Make video <kbd>V</kbd>
                  </button>
                  <button className="nx-btn" onClick={() => setNote("")}>
                    Send back with a note <kbd>E</kbd>
                  </button>
                  <button className="nx-btn nx-quiet" onClick={() => onOpenBatch(open.batch)}>
                    Open the batch
                  </button>
                </div>
              ) : (
                <div className="nx-note">
                  <div className="nx-row">
                    {QUICK_NOTES.map((q) => (
                      <button className="nx-btn nx-sm" key={q} onClick={() => setNote(q)}>
                        {q.replace(/\.$/, "")}
                      </button>
                    ))}
                  </div>
                  <textarea
                    id="review-note"
                    autoFocus
                    rows={2}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="What should change in this image?"
                    aria-label="Note for the new version"
                  />
                  <div className="nx-row">
                    <button
                      className="nx-btn nx-primary"
                      disabled={!note.trim() || busy}
                      onClick={() => void revise(open, note)}
                    >
                      Generate again with this note
                    </button>
                    <button className="nx-btn nx-quiet" onClick={() => setNote(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
      {video && (
        <VideoDialog
          items={video}
          skillTitle={title}
          onClose={() => setVideo(null)}
          onConnect={onVideo}
          onStarted={() => {
            setVideo(null);
            setPicked(new Set());
            setOpenId(null);
            onVideo();
          }}
        />
      )}
    </div>
  );
}
