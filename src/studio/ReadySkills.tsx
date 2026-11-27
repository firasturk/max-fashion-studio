import { useState } from "react";
import { toast } from "sonner";
import { post } from "@/api";
import type { SkillInfo } from "@shared/types";

export interface ReadySkill {
  id: string;
  origin: string;
  title: string;
  caption: string;
  description: string;
  photos: string[];
}

const photo = (id: string) => `/api/studio/references/${id}/file`;

/**
 * Complete skills the studio prepared from the Pinterest library: photos chosen, look named, text
 * written. Approving one only switches it on, so it is instant.
 */
export default function ReadySkills({
  items,
  onChanged,
  onApproved,
}: {
  items: ReadySkill[];
  onChanged: (items: ReadySkill[]) => void;
  onApproved: (skills: SkillInfo[], id: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<ReadySkill | null>(null);

  async function approve(s: ReadySkill) {
    setBusy(s.id);
    try {
      const r = await post<{ id: string; skills: SkillInfo[] }>("/api/studio/ready/approve", {
        id: s.id,
      });
      onChanged(items.filter((i) => i.id !== s.id));
      setOpen(null);
      toast.success(`“${s.title}” is now one of your skills`);
      onApproved(r.skills, r.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not switch the skill on.");
    } finally {
      setBusy(null);
    }
  }

  async function dismiss(s: ReadySkill) {
    onChanged(items.filter((i) => i.id !== s.id));
    setOpen(null);
    try {
      await post("/api/studio/ready/dismiss", { id: s.id });
    } catch {
      toast.error("Could not remove it. Reload and try again.");
    }
  }

  if (!items.length)
    return (
      <div className="nx-empty">
        <b>Nothing ready yet</b>
        The studio prepares complete skills from the Pinterest library in the background: it checks
        every picture, groups the ones that belong together and writes the skill. They appear here
        when they are done.
      </div>
    );
  return (
    <>
      <div className="nx-skills nx-stagger">
        {items.map((s) => (
          <article className="nx-skill nx-ready" key={s.id}>
            <button
              className="nx-skill-shot"
              onClick={() => setOpen(s)}
              aria-label={`See the photos of ${s.title}`}
            >
              {s.photos[0] && <img src={photo(s.photos[0])} alt="" loading="lazy" />}
            </button>
            <div className="nx-skill-body">
              <div className="nx-row">
                <h3>{s.title}</h3>
                <span className="nx-chip nx-end">{s.photos.length} photos</span>
              </div>
              {s.caption && (
                <p>
                  <b>Scene</b>
                  {s.caption}
                </p>
              )}
              {s.description && (
                <p className="nx-clamp">
                  <b>Look</b>
                  {s.description}
                </p>
              )}
              <div className="nx-strip nx-mini">
                {s.photos.slice(1, 6).map((id) => (
                  <img key={id} src={photo(id)} alt="" loading="lazy" />
                ))}
              </div>
              <div className="nx-row nx-foot">
                <button
                  className="nx-btn nx-sm nx-primary"
                  disabled={busy === s.id}
                  onClick={() => void approve(s)}
                >
                  Approve
                </button>
                <button className="nx-btn nx-sm" onClick={() => setOpen(s)}>
                  Photos
                </button>
                <button
                  className="nx-btn nx-sm nx-quiet"
                  disabled={busy === s.id}
                  onClick={() => void dismiss(s)}
                >
                  Not for us
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
      {open && (
        <div className="nx-scrim" onClick={(e) => e.target === e.currentTarget && setOpen(null)}>
          <section
            className="nx-sheet nx-pins"
            role="dialog"
            aria-modal="true"
            aria-label={`Photos of ${open.title}`}
          >
            <header>
              <h2>{open.title}</h2>
              <span className="nx-chip">{open.photos.length} photos</span>
              <span className="nx-muted">{open.origin}</span>
              <span className="nx-right">
                <button
                  className="nx-btn nx-sm nx-primary"
                  disabled={busy === open.id}
                  onClick={() => void approve(open)}
                >
                  Approve
                </button>
                <button className="nx-btn nx-sm nx-quiet" onClick={() => setOpen(null)}>
                  Close
                </button>
              </span>
            </header>
            <div className="nx-body">
              {open.description && <p>{open.description}</p>}
              <div className="nx-pingrid nx-libgrid nx-view">
                {open.photos.map((id) => (
                  <span key={id}>
                    <img src={photo(id)} alt="" loading="lazy" />
                  </span>
                ))}
              </div>
              <p className="nx-muted">
                After approving you can add or remove photos from the skill's Photos button, and its
                text follows them.
              </p>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
