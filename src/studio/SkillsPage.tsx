import { Suspense, lazy, useState } from "react";
import { toast } from "sonner";
import { post } from "@/api";
import type { SkillInfo } from "@shared/types";

const SkillDialog = lazy(() => import("./SkillDialog"));
const PinterestDialog = lazy(() => import("./PinterestDialog"));
const ReferenceLibrary = lazy(() => import("./ReferenceLibrary"));

/** The skill library: what each skill shoots and how it poses. One skill drives a whole folder. */
export default function SkillsPage({
  skills,
  onSaved,
}: {
  skills: SkillInfo[];
  onSaved: (skills: SkillInfo[], id?: string) => void;
}) {
  const [editor, setEditor] = useState<{ open: boolean; skill: SkillInfo | null }>({
    open: false,
    skill: null,
  });
  const [pinterest, setPinterest] = useState(false);
  /** The skill whose reference photos are open, and whether Pinterest is adding to it. */
  const [photos, setPhotos] = useState<SkillInfo | null>(null);
  const [photosKey, setPhotosKey] = useState(0);
  const [adding, setAdding] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);

  /** After the library changes, an automatic skill gets its text rewritten from the photos. */
  async function libraryChanged(skill: SkillInfo, count: number) {
    if (!skill.auto || count === 0) return;
    setRebuilding(true);
    try {
      const r = await post<{ skills: SkillInfo[] }>(`/api/studio/skills/${skill.id}/analyze`, {
        title: skill.title,
        save: true,
      });
      onSaved(r.skills, skill.id);
      toast.success("Skill text updated from its reference photos.");
    } catch (e) {
      toast.error(`Could not update the skill text: ${(e as Error).message}`);
    } finally {
      setRebuilding(false);
    }
  }
  return (
    <div className="nx nx-enter">
      <div className="nx-head">
        <div>
          <h1>Skills</h1>
          <p>
            A skill is the look of a whole delivery: the scene, the light and the pose. The Inbox
            suggests one for every new folder.
          </p>
        </div>
        <div className="nx-right">
          <button className="nx-btn nx-primary" onClick={() => setPinterest(true)}>
            New skill from Pinterest
          </button>
          <button className="nx-btn" onClick={() => setEditor({ open: true, skill: null })}>
            New skill
          </button>
        </div>
      </div>
      {skills.length ? (
        <div className="nx-skills nx-stagger">
          {skills.map((s) => (
            <article className="nx-skill" key={s.id}>
              {s.thumb ? (
                <img src={`/api/studio/references/${s.thumb}/file`} alt="" loading="lazy" />
              ) : (
                <span className="nx-skill-ph" aria-hidden="true">
                  {s.title.slice(0, 1)}
                </span>
              )}
              <div className="nx-skill-body">
                <div className="nx-row">
                  <h3>{s.title}</h3>
                  <span className="nx-chip nx-end">{s.builtIn ? "Built in" : "Team"}</span>
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
                <div className="nx-row nx-foot">
                  <button className="nx-btn nx-sm" onClick={() => setPhotos(s)}>
                    Photos
                  </button>
                  <button
                    className="nx-btn nx-sm"
                    onClick={() => setEditor({ open: true, skill: s })}
                  >
                    Edit
                  </button>
                  {s.favourite && <span className="nx-chip nx-ok">Starred</span>}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="nx-empty">
          <b>No skills yet</b>
          Create the first one to describe a look the studio should shoot.
        </div>
      )}
      {photos && !adding && (
        <div className="nx-scrim" onClick={(e) => e.target === e.currentTarget && setPhotos(null)}>
          <section
            className="nx-sheet nx-pins"
            role="dialog"
            aria-modal="true"
            aria-label={`Reference photos of ${photos.title}`}
          >
            <header>
              <h2>{photos.title}</h2>
              <span className="nx-chip">
                {photos.auto ? "Text follows the photos" : "Text written by hand"}
              </span>
              {rebuilding && <span className="nx-chip nx-warn">Rewriting the skill…</span>}
              <span className="nx-right">
                <button className="nx-btn nx-sm" onClick={() => setAdding(true)}>
                  Add from Pinterest
                </button>
                <button className="nx-btn nx-sm nx-quiet" onClick={() => setPhotos(null)}>
                  Close
                </button>
              </span>
            </header>
            <div className="nx-body nx-library">
              <Suspense fallback={null}>
                <ReferenceLibrary
                  key={`${photos.id}:${photosKey}`}
                  skill={photos.id}
                  title="Reference photos"
                  onChanged={(count) => libraryChanged(photos, count)}
                />
              </Suspense>
            </div>
          </section>
        </div>
      )}
      {photos && adding && (
        <Suspense fallback={null}>
          <PinterestDialog
            skill={photos}
            onClose={() => setAdding(false)}
            onAdded={async (count) => {
              setAdding(false);
              setPhotosKey((k) => k + 1);
              await libraryChanged(photos, count);
            }}
          />
        </Suspense>
      )}
      {pinterest && (
        <Suspense fallback={null}>
          <PinterestDialog
            onClose={() => setPinterest(false)}
            onCreated={(list, id) => {
              setPinterest(false);
              onSaved(list, id);
            }}
          />
        </Suspense>
      )}
      <Suspense fallback={null}>
        <SkillDialog
          open={editor.open}
          skill={editor.skill}
          onClose={() => setEditor((e) => ({ ...e, open: false }))}
          onSaved={onSaved}
        />
      </Suspense>
    </div>
  );
}
