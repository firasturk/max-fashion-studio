import { useState } from "react";
import { toast } from "sonner";
import { post } from "@/api";
import type { SkillInfo } from "@shared/types";

interface Pin {
  id: string;
  thumb: string;
  note: string;
}
interface Board {
  title: string;
  pins: Pin[];
  limit: number;
}

/**
 * Pictures from a public Pinterest board. Without a skill it makes a new one, the way New skill
 * does (name, tagline, then photos, then the text written from them); with a skill it adds the
 * pictures to that skill's reference library.
 */
export default function PinterestDialog({
  skill,
  onClose,
  onCreated,
  onAdded,
}: {
  skill?: { id: string; title: string };
  onClose: () => void;
  onCreated?: (skills: SkillInfo[], id: string) => void;
  onAdded?: (count: number) => void | Promise<void>;
}) {
  const [link, setLink] = useState("");
  const [board, setBoard] = useState<Board | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState<"find" | "make" | null>(null);

  async function find() {
    setBusy("find");
    try {
      const b = await post<Board>("/api/studio/pinterest/preview", { link });
      setBoard(b);
      setTitle(b.title);
      setCaption(`Pinterest · ${b.title}`.slice(0, 80));
      setPicked(new Set(b.pins.slice(0, b.limit).map((p) => p.id)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read that Pinterest link.");
    } finally {
      setBusy(null);
    }
  }

  async function make() {
    if (!board) return;
    setBusy("make");
    const pins = board.pins.filter((p) => picked.has(p.id)).map((p) => p.id);
    try {
      if (skill) {
        const r = await post<{ added: string[] }>("/api/studio/references/pinterest", {
          skill: skill.id,
          link,
          pins,
        });
        toast.success(`${r.added.length} pictures added to ${skill.title}`);
        await onAdded?.(r.added.length);
        return;
      }
      const r = await post<{
        id: string;
        photos: number;
        warning: string | null;
        skills: SkillInfo[];
      }>("/api/studio/skills/pinterest", {
        link,
        title: title.trim(),
        caption: caption.trim(),
        pins,
      });
      if (r.warning)
        toast.message(
          `Skill created with ${r.photos} pictures, but its text is not written yet: ${r.warning}`,
        );
      else toast.success(`Skill “${title.trim()}” created from ${r.photos} pictures`);
      onCreated?.(r.skills, r.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not use those pictures.");
      setBusy(null);
    }
  }

  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else if (board && n.size < board.limit) n.add(id);
      else toast.message(`Up to ${board?.limit} pictures at a time. Untick one first.`);
      return n;
    });

  const count = `${picked.size} picture${picked.size === 1 ? "" : "s"}`;
  const heading = skill ? `Add from Pinterest · ${skill.title}` : "New skill from Pinterest";
  return (
    <div className="nx-scrim" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <section className="nx-sheet nx-pins" role="dialog" aria-modal="true" aria-label={heading}>
        <header>
          <h2>{heading}</h2>
          {board && (
            <span className="nx-chip">
              {picked.size} of {board.limit} chosen
            </span>
          )}
          <span className="nx-right">
            <button className="nx-btn nx-sm nx-quiet" disabled={!!busy} onClick={onClose}>
              Close
            </button>
          </span>
        </header>
        <div className="nx-body">
          <p className="nx-muted">
            Paste the link of a public Pinterest board (or one pin). The pictures you choose go into
            the skill's reference library, like uploaded photos: its direction and scene library are
            written from them, and each image borrows background, pose and light from one of them.
            The outfit, footwear and accessories never change.
          </p>
          <div className="nx-code">
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && link.trim() && void find()}
              placeholder="https://www.pinterest.com/name/board/"
              aria-label="Pinterest link"
              autoFocus
            />
            <button
              className="nx-btn"
              disabled={!link.trim() || !!busy}
              onClick={() => void find()}
            >
              {busy === "find" ? "Looking…" : board ? "Look again" : "Find the pictures"}
            </button>
          </div>
          {board && (
            <>
              <div className="nx-pingrid">
                {board.pins.map((p) => (
                  <button
                    key={p.id}
                    className={picked.has(p.id) ? "nx-on" : ""}
                    aria-pressed={picked.has(p.id)}
                    title={p.note}
                    onClick={() => toggle(p.id)}
                  >
                    <img
                      src={p.thumb}
                      alt={p.note || "Pinterest picture"}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                    <i aria-hidden="true">{picked.has(p.id) ? "✓" : ""}</i>
                  </button>
                ))}
              </div>
              {!skill && (
                <div className="nx-opts">
                  <label>
                    <span>Name</span>
                    <input
                      className="nx-input"
                      value={title}
                      maxLength={60}
                      onChange={(e) => setTitle(e.target.value)}
                      aria-label="Skill name"
                    />
                  </label>
                  <label>
                    <span>Short tagline (optional)</span>
                    <input
                      className="nx-input"
                      value={caption}
                      maxLength={80}
                      onChange={(e) => setCaption(e.target.value)}
                      aria-label="Short tagline"
                    />
                  </label>
                </div>
              )}
              <div className="nx-row">
                <button
                  className="nx-btn nx-primary"
                  disabled={!picked.size || (!skill && title.trim().length < 2) || !!busy}
                  onClick={() => void make()}
                >
                  {busy === "make"
                    ? skill
                      ? "Adding the pictures…"
                      : "Reading the pictures and writing the skill…"
                    : skill
                      ? `Add ${count}`
                      : `Create the skill from ${count}`}
                </button>
                {busy === "make" && <span className="nx-muted">This takes up to a minute.</span>}
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
