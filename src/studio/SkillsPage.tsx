import { Suspense, lazy, useState } from "react";
import type { SkillInfo } from "@shared/types";

const SkillDialog = lazy(() => import("./SkillDialog"));

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
