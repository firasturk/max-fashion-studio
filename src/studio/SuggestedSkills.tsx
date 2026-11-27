import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { get, post } from "@/api";
import type { SkillInfo } from "@shared/types";

interface Suggestion {
  id: string;
  link: string;
  title: string;
  caption: string;
  why: string;
  pins: { id: string; thumb: string }[];
}

/**
 * Skills the studio proposes from the Pinterest accounts it watches. Nothing becomes a skill
 * until someone approves it here.
 */
export default function SuggestedSkills({
  admin,
  onCreated,
}: {
  admin: boolean;
  onCreated: (skills: SkillInfo[], id: string) => void;
}) {
  const [items, setItems] = useState<Suggestion[] | null>(null);
  const [sources, setSources] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await get<{ items: Suggestion[]; sources: string[] }>("/api/studio/suggestions");
      setItems(r.items);
      setSources(r.sources);
    } catch {
      setItems([]);
    }
  }, []);
  useEffect(() => void load(), [load]);

  async function approve(s: Suggestion) {
    setBusy(s.id);
    try {
      const r = await post<{
        id: string;
        photos: number;
        warning: string | null;
        skills: SkillInfo[];
      }>("/api/studio/suggestions/approve", { id: s.id });
      setItems((list) => (list ?? []).filter((i) => i.id !== s.id));
      if (r.warning)
        toast.message(
          `“${s.title}” was added with ${r.photos} photos, but its text is not written yet: ${r.warning}`,
        );
      else toast.success(`“${s.title}” is now a skill, built from ${r.photos} photos`);
      onCreated(r.skills, r.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the skill.");
    } finally {
      setBusy(null);
    }
  }

  async function dismiss(s: Suggestion) {
    setItems((list) => (list ?? []).filter((i) => i.id !== s.id));
    try {
      await post("/api/studio/suggestions/dismiss", { id: s.id });
    } catch {
      void load();
    }
  }

  async function look() {
    setBusy("look");
    try {
      const r = await post<{ made: number; items: Suggestion[] }>(
        "/api/studio/suggestions/refresh",
      );
      setItems(r.items);
      toast.success(
        r.made ? `${r.made} new idea${r.made === 1 ? "" : "s"}` : "No new ideas this time",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not look for ideas.");
    } finally {
      setBusy(null);
    }
  }

  async function saveSources() {
    setBusy("sources");
    try {
      const r = await post<{ sources: string[] }>("/api/studio/suggestions/sources", {
        links: (editing ?? "").split(/\s+/).filter(Boolean),
      });
      setSources(r.sources);
      setEditing(null);
      toast.success("Saved. New ideas arrive within a day, or look for them now.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the list.");
    } finally {
      setBusy(null);
    }
  }

  if (items === null || (!items.length && !admin)) return null;
  return (
    <section className="nx-suggest" aria-label="Suggested skills">
      <div className="nx-row">
        <h2>Suggested for you</h2>
        <span className="nx-muted">
          {items.length
            ? "Looks the studio found on Pinterest. Approve one and it becomes a skill."
            : `Watching ${sources.length} Pinterest account${sources.length === 1 ? "" : "s"}. Ideas appear here once a day.`}
        </span>
        {admin && (
          <span className="nx-row nx-end">
            <button className="nx-btn nx-sm" disabled={busy === "look"} onClick={() => void look()}>
              {busy === "look" ? "Looking, about a minute…" : "Look for new ideas"}
            </button>
            <button
              className="nx-btn nx-sm nx-quiet"
              onClick={() => setEditing(sources.join("\n"))}
            >
              Accounts to watch
            </button>
          </span>
        )}
      </div>
      {items.length > 0 && (
        <div className="nx-ideas nx-stagger">
          {items.map((s) => (
            <article className="nx-idea" key={s.id}>
              <a
                className="nx-idea-strip"
                href={s.link}
                target="_blank"
                rel="noreferrer"
                title="Open on Pinterest"
              >
                {s.pins.slice(0, 5).map((p) => (
                  <img
                    key={p.id}
                    src={p.thumb}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                ))}
              </a>
              <div className="nx-idea-body">
                <div className="nx-row">
                  <h3>{s.title}</h3>
                  <span className="nx-chip nx-end">{s.pins.length} photos</span>
                </div>
                <p className="nx-muted">{s.caption}</p>
                {s.why && <p>{s.why}</p>}
                <div className="nx-row nx-foot">
                  <button
                    className="nx-btn nx-sm nx-primary"
                    disabled={busy === s.id}
                    onClick={() => void approve(s)}
                  >
                    {busy === s.id ? "Building the skill, up to a minute…" : "Approve"}
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
      )}
      {editing !== null && (
        <div className="nx-scrim" onClick={(e) => e.target === e.currentTarget && setEditing(null)}>
          <section
            className="nx-sheet nx-small"
            role="dialog"
            aria-modal="true"
            aria-label="Accounts to watch"
          >
            <header>
              <h2>Accounts to watch</h2>
              <span className="nx-right">
                <button className="nx-btn nx-sm nx-quiet" onClick={() => setEditing(null)}>
                  Close
                </button>
              </span>
            </header>
            <div className="nx-body">
              <p>
                One Pinterest link per line: a public account or a public board. The studio reads
                them once a day and proposes skills from the looks it finds.
              </p>
              <textarea
                rows={8}
                value={editing}
                onChange={(e) => setEditing(e.target.value)}
                placeholder="https://www.pinterest.com/name/"
                aria-label="Pinterest accounts and boards"
              />
              <div className="nx-row">
                <button
                  className="nx-btn nx-primary"
                  disabled={busy === "sources"}
                  onClick={() => void saveSources()}
                >
                  {busy === "sources" ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
