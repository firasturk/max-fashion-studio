import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { get, post } from "@/api";
import type { SkillInfo } from "@shared/types";

interface LibraryPin {
  id: string;
  account: string;
  board: string;
  thumb: string;
  note: string;
}
interface Library {
  pins: LibraryPin[];
  total: number;
  accounts: { account: string; n: number }[];
  boards: { board: string; n: number }[];
  sources: string[];
  limit: number;
}

/**
 * The Pinterest library: pictures the studio gathered from the accounts it watches. People tick
 * the ones they like and turn them into a skill, add them to one, or hide them. Nothing here is
 * decided by the studio.
 */
export default function PinLibrary({
  admin,
  skills,
  onCreated,
  onAddedTo,
  onCount,
}: {
  admin: boolean;
  skills: SkillInfo[];
  onCreated: (skills: SkillInfo[], id: string) => void;
  onAddedTo: (skill: SkillInfo, count: number) => void | Promise<void>;
  onCount: (total: number) => void;
}) {
  const [lib, setLib] = useState<Library | null>(null);
  const [account, setAccount] = useState("");
  const [board, setBoard] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"new" | "add" | "sources" | null>(null);
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [target, setTarget] = useState("");
  const [links, setLinks] = useState("");

  const load = useCallback(
    async (offset = 0) => {
      const q = new URLSearchParams({ offset: String(offset) });
      if (account) q.set("account", account);
      if (account && board) q.set("board", board);
      const r = await get<Library>(`/api/studio/library?${q}`);
      setLib((old) => (offset && old ? { ...r, pins: [...old.pins, ...r.pins] } : r));
      if (!account) onCount(r.total);
      return r;
    },
    [account, board, onCount],
  );

  const gather = useCallback(async () => {
    setBusy("gather");
    try {
      const r = await post<{ added: number }>("/api/studio/library/refresh");
      await load();
      toast.success(r.added ? `${r.added} new pictures` : "No new pictures since the last look");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not reach Pinterest.");
    } finally {
      setBusy(null);
    }
  }, [load]);

  // The first visit fills the library by itself; after that it is already there.
  useEffect(() => {
    void load()
      .then((r) => {
        if (!r.total && !r.accounts.length && r.sources.length && !account) void gather();
      })
      .catch(() =>
        setLib({ pins: [], total: 0, accounts: [], boards: [], sources: [], limit: 24 }),
      );
  }, [load, gather, account]);

  const limit = lib?.limit ?? 24;
  const chosen = (lib?.pins ?? []).filter((p) => picked.has(p.id));
  const drop = (ids: string[]) => {
    setLib((l) =>
      l
        ? {
            ...l,
            pins: l.pins.filter((p) => !ids.includes(p.id)),
            total: Math.max(0, l.total - ids.length),
          }
        : l,
    );
    setPicked(new Set());
    setSheet(null);
  };

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That did not work. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const ids = chosen.map((p) => p.id);
  const create = () =>
    run("new", async () => {
      const r = await post<{
        id: string;
        photos: number;
        warning: string | null;
        skills: SkillInfo[];
      }>("/api/studio/skills/pinterest", {
        title: title.trim(),
        caption: caption.trim(),
        pins: ids,
      });
      if (r.warning)
        toast.message(
          `Skill created with ${r.photos} pictures, but its text is not written yet: ${r.warning}`,
        );
      else toast.success(`Skill “${title.trim()}” created from ${r.photos} pictures`);
      drop(ids);
      setTitle("");
      setCaption("");
      onCreated(r.skills, r.id);
    });
  const addTo = () =>
    run("add", async () => {
      const skill = skills.find((s) => s.id === target);
      if (!skill) return;
      const r = await post<{ added: string[] }>("/api/studio/references/pinterest", {
        skill: skill.id,
        pins: ids,
      });
      toast.success(`${r.added.length} pictures added to ${skill.title}`);
      drop(ids);
      await onAddedTo(skill, r.added.length);
    });
  const hide = () =>
    run("hide", async () => {
      await post("/api/studio/library/hide", { pins: ids });
      drop(ids);
    });
  const saveSources = () =>
    run("sources", async () => {
      const r = await post<{ added: number }>("/api/studio/library/sources", {
        links: links.split(/\s+/).filter(Boolean),
      });
      setSheet(null);
      await load();
      toast.success(`Saved. ${r.added} new pictures gathered.`);
    });

  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else if (n.size < limit) n.add(id);
      else toast.message(`Up to ${limit} pictures at a time.`);
      return n;
    });

  if (!lib) return null;
  return (
    <section className="nx-lib" aria-label="Pinterest library">
      <div className="nx-row">
        <div className="nx-seg" role="group" aria-label="Account">
          <button
            aria-pressed={!account}
            onClick={() => {
              setAccount("");
              setBoard("");
            }}
          >
            All
          </button>
          {lib.accounts.map((a) => (
            <button
              key={a.account}
              aria-pressed={account === a.account}
              onClick={() => {
                setAccount(a.account);
                setBoard("");
              }}
            >
              {a.account} <span className="nx-mono">{a.n}</span>
            </button>
          ))}
        </div>
        <span className="nx-row nx-end">
          <button
            className="nx-btn nx-sm"
            disabled={busy === "gather"}
            onClick={() => void gather()}
          >
            {busy === "gather" ? "Gathering…" : "Get new pictures"}
          </button>
          {admin && (
            <button
              className="nx-btn nx-sm nx-quiet"
              onClick={() => {
                setLinks(lib.sources.join("\n"));
                setSheet("sources");
              }}
            >
              Accounts to watch
            </button>
          )}
        </span>
      </div>
      {account && lib.boards.length > 1 && (
        <div className="nx-row nx-boards">
          <button className={`nx-chip ${!board ? "nx-on" : ""}`} onClick={() => setBoard("")}>
            All boards
          </button>
          {lib.boards.map((b) => (
            <button
              key={b.board}
              className={`nx-chip ${board === b.board ? "nx-on" : ""}`}
              onClick={() => setBoard(b.board)}
            >
              {b.board || "No board"} <span className="nx-mono">{b.n}</span>
            </button>
          ))}
        </div>
      )}
      {lib.pins.length ? (
        <>
          <div className="nx-pingrid nx-libgrid">
            {lib.pins.map((p) => (
              <button
                key={p.id}
                className={picked.has(p.id) ? "nx-on" : ""}
                aria-pressed={picked.has(p.id)}
                title={[p.account, p.board, p.note].filter(Boolean).join(" · ")}
                onClick={() => toggle(p.id)}
              >
                <img
                  src={p.thumb}
                  alt={p.note || `${p.account} picture`}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
                <i aria-hidden="true">{picked.has(p.id) ? "✓" : ""}</i>
              </button>
            ))}
          </div>
          {lib.pins.length < lib.total && (
            <button className="nx-btn nx-more-btn" onClick={() => void load(lib.pins.length)}>
              Show more of {lib.total - lib.pins.length}
            </button>
          )}
        </>
      ) : (
        <div className="nx-empty">
          <b>{busy === "gather" ? "Gathering pictures from Pinterest…" : "No pictures waiting"}</b>
          {busy === "gather"
            ? "This takes a few seconds."
            : "Use Get new pictures, or add accounts you like under Accounts to watch."}
        </div>
      )}
      {chosen.length > 0 && !sheet && (
        <div className="nx-bulk">
          <span>
            <b>{chosen.length}</b> selected
          </span>
          <button className="nx-btn nx-primary" onClick={() => setSheet("new")}>
            New skill
          </button>
          <button
            className="nx-btn"
            onClick={() => {
              setTarget(skills[0]?.id ?? "");
              setSheet("add");
            }}
          >
            Add to a skill
          </button>
          <button className="nx-btn" disabled={busy === "hide"} onClick={() => void hide()}>
            Hide
          </button>
          <button className="nx-btn" onClick={() => setPicked(new Set())}>
            Clear
          </button>
        </div>
      )}
      {sheet && (
        <div
          className="nx-scrim"
          onClick={(e) => e.target === e.currentTarget && !busy && setSheet(null)}
        >
          <section className="nx-sheet nx-small" role="dialog" aria-modal="true">
            <header>
              <h2>
                {sheet === "new"
                  ? "New skill"
                  : sheet === "add"
                    ? "Add to a skill"
                    : "Accounts to watch"}
              </h2>
              {sheet !== "sources" && <span className="nx-chip">{chosen.length} pictures</span>}
              <span className="nx-right">
                <button
                  className="nx-btn nx-sm nx-quiet"
                  disabled={!!busy}
                  onClick={() => setSheet(null)}
                >
                  Close
                </button>
              </span>
            </header>
            <div className="nx-body">
              {sheet === "new" && (
                <>
                  <label className="nx-opt-wide">
                    <span>Name</span>
                    <input
                      className="nx-input"
                      value={title}
                      maxLength={60}
                      autoFocus
                      placeholder="e.g. Ramadan evening"
                      onChange={(e) => setTitle(e.target.value)}
                    />
                  </label>
                  <label className="nx-opt-wide">
                    <span>Short tagline (optional)</span>
                    <input
                      className="nx-input"
                      value={caption}
                      maxLength={80}
                      placeholder="e.g. Lanterns, courtyards, dusk"
                      onChange={(e) => setCaption(e.target.value)}
                    />
                  </label>
                  <p>
                    The pictures go into the skill's reference library and its direction is written
                    from them. This takes up to a minute.
                  </p>
                  <div className="nx-row">
                    <button
                      className="nx-btn nx-primary"
                      disabled={title.trim().length < 2 || busy === "new"}
                      onClick={() => void create()}
                    >
                      {busy === "new"
                        ? "Building the skill…"
                        : `Create from ${chosen.length} pictures`}
                    </button>
                  </div>
                </>
              )}
              {sheet === "add" && (
                <>
                  <label className="nx-opt-wide">
                    <span>Skill</span>
                    <select value={target} onChange={(e) => setTarget(e.target.value)}>
                      {skills.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="nx-row">
                    <button
                      className="nx-btn nx-primary"
                      disabled={!target || busy === "add"}
                      onClick={() => void addTo()}
                    >
                      {busy === "add" ? "Adding…" : `Add ${chosen.length} pictures`}
                    </button>
                  </div>
                </>
              )}
              {sheet === "sources" && (
                <>
                  <p>
                    One Pinterest link per line: a public account or a public board. The studio
                    gathers their pictures a few times a day. Product feeds and advert boards are
                    left out.
                  </p>
                  <textarea
                    rows={8}
                    value={links}
                    onChange={(e) => setLinks(e.target.value)}
                    placeholder="https://www.pinterest.com/name/"
                    aria-label="Pinterest accounts and boards"
                  />
                  <div className="nx-row">
                    <button
                      className="nx-btn nx-primary"
                      disabled={busy === "sources"}
                      onClick={() => void saveSources()}
                    >
                      {busy === "sources" ? "Saving and gathering…" : "Save"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
