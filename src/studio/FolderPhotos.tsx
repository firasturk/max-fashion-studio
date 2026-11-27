import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { get, post } from "@/api";
import type { SkillInfo } from "@shared/types";
import { skillTone } from "./tone";

interface Photo {
  id: string;
  token: string;
  name: string;
  product: string;
  view: number | null;
  tag: boolean;
  usual: boolean;
}
type Plan = Record<string, string>;

const thumb = (p: Photo, large = false) =>
  `/api/studio/drive/thumb?id=${encodeURIComponent(p.id)}&t=${p.token}${large ? "&size=large" : ""}`;

/**
 * Every photo of one Drive folder, before it is approved. By default the first two views of each
 * product are generated with the folder's skill; here a person can give single photos (or a whole
 * product) another skill, add a view, or leave one out. Nothing is generated from this screen.
 */
export default function FolderPhotos({
  folder,
  skills,
  folderSkill,
  onClose,
  onSaved,
}: {
  folder: { id: string; name: string };
  skills: SkillInfo[];
  /** The skill chosen for the folder as a whole; photos without their own skill use it. */
  folderSkill: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [plan, setPlan] = useState<Plan>({});
  const [saved, setSaved] = useState("{}");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    get<{ photos: Photo[]; plan: Plan }>(`/api/studio/drive/photos?folder=${folder.id}`)
      .then((r) => {
        if (!live) return;
        setPhotos(r.photos);
        setPlan(r.plan);
        setSaved(JSON.stringify(r.plan));
      })
      .catch((e) => {
        toast.error(e instanceof Error ? e.message : "Could not read the folder.");
        onClose();
      });
    return () => {
      live = false;
    };
  }, [folder.id, onClose]);

  const title = (id: string) => skills.find((s) => s.id === id)?.title ?? id;
  /** Whether a photo will be generated, and with which skill ("" = the folder's). */
  const fate = (p: Photo): { on: boolean; skill: string } => {
    const choice = plan[p.id];
    if (choice === "") return { on: false, skill: "" };
    if (choice === undefined) return { on: p.usual, skill: "" };
    return { on: true, skill: choice === "*" ? "" : choice };
  };

  const products = useMemo(() => {
    const map = new Map<string, Photo[]>();
    for (const p of photos ?? []) map.set(p.product, [...(map.get(p.product) ?? []), p]);
    return [...map.entries()].map(([product, list]) => ({
      product,
      list: list.sort((a, b) => (a.view ?? 99) - (b.view ?? 99) || a.name.localeCompare(b.name)),
    }));
  }, [photos]);

  /** Gives photos a choice, dropping the ones that only repeat the usual rule. */
  const choose = (list: Photo[], choice: string) =>
    setPlan((old) => {
      const next = { ...old };
      for (const p of list) {
        if ((choice === "*" && p.usual) || (choice === "" && !p.usual)) delete next[p.id];
        else next[p.id] = choice;
      }
      return next;
    });

  const toggle = (id: string) =>
    setPicked((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function save() {
    setBusy(true);
    try {
      const r = await post<{ files: number; choices: number }>("/api/studio/drive/plan", {
        folder: folder.id,
        plan,
      });
      setSaved(JSON.stringify(plan));
      toast.success(`Saved: ${r.files} photos will be generated when you approve the folder.`);
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the choices.");
    } finally {
      setBusy(false);
    }
  }

  const list = photos ?? [];
  const chosen = list.filter((p) => picked.has(p.id));
  const going = list.filter((p) => fate(p).on).length;
  const dirty = JSON.stringify(plan) !== saved;
  const open = zoom ? list.find((p) => p.id === zoom) : undefined;
  const close = () => {
    if (busy) return;
    if (dirty && !window.confirm("Close without saving your choices?")) return;
    onClose();
  };

  return (
    <div className="nx-scrim" onClick={(e) => e.target === e.currentTarget && close()}>
      <section
        className="nx-sheet nx-pins nx-photos"
        role="dialog"
        aria-modal="true"
        aria-label={`Photos in ${folder.name}`}
      >
        <header>
          <h2>{folder.name}</h2>
          {photos && (
            <span className="nx-chip">
              {going} of {list.length} photos will be generated
            </span>
          )}
          <span className="nx-right">
            <button className="nx-btn nx-sm nx-quiet" disabled={busy} onClick={close}>
              Close
            </button>
          </span>
        </header>
        {!photos ? (
          <div className="nx-body">
            <p className="nx-muted">Reading the folder from Drive…</p>
          </div>
        ) : (
          <>
            <div className="nx-phbar">
              <div className="nx-seg" role="group" aria-label="Which photos">
                <button aria-pressed={!all} onClick={() => setAll(false)}>
                  To generate <span className="nx-mono">{going}</span>
                </button>
                <button aria-pressed={all} onClick={() => setAll(true)}>
                  All photos <span className="nx-mono">{list.length}</span>
                </button>
              </div>
              {chosen.length ? (
                <>
                  <b>{chosen.length} selected</b>
                  <select
                    aria-label="Skill for the selected photos"
                    value=""
                    onChange={(e) => {
                      if (!e.target.value) return;
                      choose(chosen, e.target.value);
                      setPicked(new Set());
                    }}
                  >
                    <option value="">Give them a skill…</option>
                    <option value="*">
                      The folder's skill{folderSkill ? ` (${title(folderSkill)})` : ""}
                    </option>
                    {skills.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title}
                      </option>
                    ))}
                  </select>
                  <button
                    className="nx-btn nx-sm"
                    onClick={() => {
                      choose(chosen, "");
                      setPicked(new Set());
                    }}
                  >
                    Leave out
                  </button>
                  <button className="nx-btn nx-sm nx-quiet" onClick={() => setPicked(new Set())}>
                    Clear
                  </button>
                </>
              ) : (
                <span className="nx-muted">
                  Click photos to select them, then give them a skill or leave them out. The
                  magnifier opens a photo large.
                </span>
              )}
            </div>
            <div className="nx-body">
              {products.map(({ product, list: group }) => {
                const shown = all ? group : group.filter((p) => fate(p).on);
                if (!shown.length) return null;
                const live = group.filter((p) => fate(p).on);
                const own = [...new Set(live.map((p) => fate(p).skill))];
                return (
                  <div className="nx-product" key={product || "loose"}>
                    <div className="nx-row">
                      <b className="nx-mono">{product || "Loose photos"}</b>
                      <span className="nx-muted">
                        {live.length} of {group.length}
                      </span>
                      <span className="nx-right">
                        <select
                          aria-label={`Skill for ${product || "these photos"}`}
                          value={own.length === 1 ? own[0] || "*" : ""}
                          onChange={(e) => e.target.value && choose(live, e.target.value)}
                          disabled={!live.length}
                        >
                          {own.length !== 1 && <option value="">Mixed skills</option>}
                          <option value="*">
                            The folder's skill{folderSkill ? ` (${title(folderSkill)})` : ""}
                          </option>
                          {skills.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.title}
                            </option>
                          ))}
                        </select>
                        <button
                          className="nx-btn nx-sm nx-quiet"
                          onClick={() =>
                            setPicked((old) => {
                              const next = new Set(old);
                              const every = shown.every((p) => next.has(p.id));
                              for (const p of shown) {
                                if (every) next.delete(p.id);
                                else next.add(p.id);
                              }
                              return next;
                            })
                          }
                        >
                          Select
                        </button>
                      </span>
                    </div>
                    <div className="nx-phgrid">
                      {shown.map((p) => {
                        const f = fate(p);
                        return (
                          <div
                            key={p.id}
                            className={`nx-ph${picked.has(p.id) ? " nx-on" : ""}${f.on ? "" : " nx-off"}`}
                          >
                            <button
                              className="nx-phpick"
                              aria-pressed={picked.has(p.id)}
                              aria-label={`${p.name}${f.on ? "" : ", left out"}`}
                              onClick={() => toggle(p.id)}
                            >
                              <img src={thumb(p)} alt="" loading="lazy" />
                            </button>
                            <button
                              className="nx-phzoom"
                              aria-label={`Open ${p.name} large`}
                              onClick={() => setZoom(p.id)}
                            >
                              ⌕
                            </button>
                            <span className="nx-phname nx-mono">
                              {p.tag ? "tag" : p.view !== null ? `view ${p.view}` : p.name}
                            </span>
                            {!f.on ? (
                              <span className="nx-phtag nx-chip">Left out</span>
                            ) : f.skill ? (
                              <span className={`nx-phtag ${skillTone(f.skill)}`}>
                                {title(f.skill)}
                              </span>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            <footer className="nx-phfoot">
              <span className="nx-muted">
                {Object.keys(plan).length
                  ? `${Object.keys(plan).length} photos have a choice of their own.`
                  : "Every product: front and back, with the folder's skill."}
              </span>
              {Object.keys(plan).length > 0 && (
                <button className="nx-btn nx-quiet" disabled={busy} onClick={() => setPlan({})}>
                  Back to the usual
                </button>
              )}
              <button
                className="nx-btn nx-primary"
                disabled={busy || !dirty || !going}
                onClick={() => void save()}
              >
                {busy ? "Saving…" : "Save choices"}
              </button>
            </footer>
          </>
        )}
      </section>
      {open && (
        <div className="nx-lightbox" onClick={() => setZoom(null)} role="presentation">
          <img src={thumb(open, true)} alt={open.name} />
          <span className="nx-mono">
            {open.product ? `${open.product} / ` : ""}
            {open.name}
          </span>
        </div>
      )}
    </div>
  );
}
