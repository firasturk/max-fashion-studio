import { useState } from "react";
import { toast } from "sonner";
import { post } from "@/api";
import type { SkillInfo } from "@shared/types";

interface Pin {
  id: string;
  thumb: string;
  note: string;
}
interface Found {
  title: string;
  pins: Pin[];
  limit: number;
}

/**
 * Pictures chosen on Pinterest. Paste the links of pins you like (as many as you want), or a
 * whole board or account, and tick the ones to keep. Without a skill this makes a new one, the
 * way New skill does (name, tagline, then photos, then the text written from them); with a skill
 * it adds the pictures to that skill's reference library.
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
  const [links, setLinks] = useState("");
  const [pins, setPins] = useState<Pin[]>([]);
  const [limit, setLimit] = useState(12);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState<"find" | "make" | null>(null);

  /** Reads every pasted link and adds its pictures to the ones already on the table. */
  async function find() {
    const list = links.split(/\s+/).filter(Boolean).slice(0, 30);
    if (!list.length) return;
    setBusy("find");
    const fresh: Pin[] = [];
    const single = new Set<string>();
    let failed = 0;
    let max = limit;
    let name = "";
    for (const link of list) {
      try {
        const f = await post<Found>("/api/studio/pinterest/preview", { link });
        max = f.limit;
        fresh.push(...f.pins);
        // One pin was chosen on purpose; a board or an account is a pile to choose from.
        if (f.pins.length === 1) single.add(f.pins[0].id);
        else name ||= f.title;
      } catch {
        failed++;
      }
    }
    const known = new Set(pins.map((p) => p.id));
    const added = fresh.filter(
      (p, i) => !known.has(p.id) && fresh.findIndex((q) => q.id === p.id) === i,
    );
    setLimit(max);
    setPins([...pins, ...added]);
    setPicked((old) => {
      const next = new Set(old);
      const wanted = added.filter((p) => single.has(p.id));
      // Nothing chosen yet and only piles were pasted: start with the first few.
      const start = !next.size && !wanted.length ? added.slice(0, max) : wanted;
      for (const p of start) if (next.size < max) next.add(p.id);
      return next;
    });
    if (!title && name) {
      setTitle(name);
      setCaption(`Pinterest · ${name}`.slice(0, 80));
    }
    if (added.length) setLinks("");
    if (failed)
      toast.error(
        failed === list.length
          ? "Pinterest could not read those links. Use the link of a pin, a public board or an account."
          : `${failed} link${failed === 1 ? "" : "s"} could not be read; the rest were added.`,
      );
    else if (!added.length) toast.message("Those pictures are already here.");
    setBusy(null);
  }

  async function make() {
    setBusy("make");
    const chosen = pins.filter((p) => picked.has(p.id)).map((p) => p.id);
    try {
      if (skill) {
        const r = await post<{ added: string[] }>("/api/studio/references/pinterest", {
          skill: skill.id,
          pins: chosen,
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
        title: title.trim(),
        caption: caption.trim(),
        pins: chosen,
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
      else if (n.size < limit) n.add(id);
      else toast.message(`Up to ${limit} pictures at a time. Untick one first.`);
      return n;
    });

  const count = `${picked.size} picture${picked.size === 1 ? "" : "s"}`;
  const heading = skill ? `Add from Pinterest · ${skill.title}` : "New skill from Pinterest";
  return (
    <div className="nx-scrim" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <section className="nx-sheet nx-pins" role="dialog" aria-modal="true" aria-label={heading}>
        <header>
          <h2>{heading}</h2>
          {pins.length > 0 && (
            <span className="nx-chip">
              {picked.size} of {limit} chosen
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
            Choose the pictures yourself: on Pinterest, open a picture you like, copy its link
            (Share, then Copy link) and paste it here. Paste as many links as you want, one per
            line, and keep adding. A public board or account link also works if you want a pile to
            choose from. No board of your own is needed.
          </p>
          <div className="nx-code nx-top-align">
            <textarea
              rows={3}
              value={links}
              onChange={(e) => setLinks(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void find();
              }}
              placeholder={"https://pin.it/…\nhttps://www.pinterest.com/pin/…"}
              aria-label="Pinterest links"
              autoFocus
            />
            <button
              className="nx-btn"
              disabled={!links.trim() || !!busy}
              onClick={() => void find()}
            >
              {busy === "find"
                ? "Looking…"
                : pins.length
                  ? "Add more pictures"
                  : "Add the pictures"}
            </button>
          </div>
          {pins.length > 0 && (
            <>
              <div className="nx-pingrid">
                {pins.map((p) => (
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
                      placeholder="e.g. Ramadan evening"
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
                      placeholder="e.g. Lanterns, courtyards, dusk"
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
                {!skill && !busy && picked.size > 0 && title.trim().length < 2 && (
                  <span className="nx-muted">Give the skill a name first.</span>
                )}
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
