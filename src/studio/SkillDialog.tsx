import { useEffect, useState } from "react";
import { LoaderCircle, RotateCcw, Save, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { del, post } from "@/api";
import type { SkillInfo } from "@shared/types";

const EMPTY: SkillInfo = {
  id: "",
  title: "",
  caption: "",
  description: "",
  goal: "",
  library: `# Library

## Scene families
1. 
2. 
3. 

## Poses
- 

## Light
- 

## Camera
- 

## Colour grade
- 

## Avoid
- `,
  builtIn: false,
  edited: false,
  auto: true,
  favourite: false,
};

/** Create or edit a skill: the direction (goal) and library text are what the prompt builder reads. */
export default function SkillDialog({
  open,
  skill,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** null = new skill */
  skill: SkillInfo | null;
  onClose: () => void;
  onSaved: (skills: SkillInfo[], id?: string) => void;
}) {
  const [form, setForm] = useState<SkillInfo>(EMPTY);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(skill ?? EMPTY);
      setShowText(false);
      setBuiltFromPhotos(false);
    }
  }, [open, skill]);

  const set = (patch: Partial<SkillInfo>) => setForm((f) => ({ ...f, ...patch }));
  const [showText, setShowText] = useState(false);
  const [builtFromPhotos, setBuiltFromPhotos] = useState(false);
  const creating = !skill;
  // Editing the direction or library by hand switches the skill to manual text.
  const textTouched =
    !!skill && (form.goal !== skill.goal || form.library !== skill.library);

  async function save() {
    setBusy(true);
    try {
      const r = await post<{ id: string; skills: SkillInfo[] }>("/api/studio/skills", {
        id: form.id || undefined,
        title: form.title,
        caption: form.caption,
        description: form.description,
        goal: creating ? "" : form.goal,
        library: creating ? "" : form.library,
        auto: creating ? true : builtFromPhotos ? true : textTouched ? false : form.auto,
      });
      onSaved(r.skills, r.id);
      toast.success(skill ? "Skill saved." : "Skill created.");
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!skill) return;
    const msg = skill.builtIn
      ? `Hide the built-in skill "${skill.title}"? You can restore it later.`
      : `Delete the skill "${skill.title}"? Its reference photos stay in the library.`;
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      const r = await del<{ skills: SkillInfo[] }>(`/api/studio/skills/${skill.id}`);
      onSaved(r.skills);
      toast.success(skill.builtIn ? "Skill hidden." : "Skill deleted.");
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!skill?.builtIn) return;
    if (!window.confirm(`Restore "${skill.title}" to its original text?`)) return;
    setBusy(true);
    try {
      const r = await post<{ skills: SkillInfo[] }>(`/api/studio/skills/${skill.id}/reset`, {});
      onSaved(r.skills, skill.id);
      toast.success("Original text restored.");
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const canSave = form.title.trim().length >= 2;

  async function buildFromReferences() {
    if (!skill) return;
    setBusy(true);
    try {
      const r = await post<{ description: string; goal: string; library: string }>(
        `/api/studio/skills/${skill.id}/analyze`,
        { title: form.title || skill.title },
      );
      set({ goal: r.goal, library: r.library, description: r.description || form.description, auto: true });
      setBuiltFromPhotos(true);
      toast.success("Direction and library written from the reference photos. Review, then Save.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="connection-dialog skill-dialog">
        <DialogHeader>
          <DialogTitle>{skill ? `Edit skill · ${skill.title}` : "New skill"}</DialogTitle>
        </DialogHeader>
        {creating ? (
          <>
            <label className="field-label" htmlFor="skill-title">
              Name
            </label>
            <input
              id="skill-title"
              className="text-input"
              value={form.title}
              onChange={(e) => set({ title: e.target.value })}
              placeholder="e.g. Ramadan evening"
              autoFocus
            />
            <label className="field-label" htmlFor="skill-caption">
              Short tagline (optional)
            </label>
            <input
              id="skill-caption"
              className="text-input"
              value={form.caption}
              onChange={(e) => set({ caption: e.target.value })}
              placeholder="e.g. Lanterns, courtyards, dusk"
            />
            <p className="prompt-tip">
              That is all. After saving, add reference photos to the skill's library: its direction
              and scene library are written from them automatically and refreshed whenever you add
              or remove photos. Every image borrows background, pose, light and camera angle from
              one photo; the original outfit, footwear and accessories never change.
            </p>
          </>
        ) : (
          <>
            <div className="two-fields">
              <div>
                <label className="field-label" htmlFor="skill-title">
                  Name
                </label>
                <input
                  id="skill-title"
                  className="text-input"
                  value={form.title}
                  onChange={(e) => set({ title: e.target.value })}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="skill-caption">
                  Short tagline
                </label>
                <input
                  id="skill-caption"
                  className="text-input"
                  value={form.caption}
                  onChange={(e) => set({ caption: e.target.value })}
                />
              </div>
            </div>
            <p className="prompt-tip">
              {form.auto && !textTouched
                ? "Text is automatic: written from the reference photos and refreshed when they change. Editing the text below switches this skill to manual."
                : "Text is manual: it stays as written here. Use \"Build from reference photos\" to rewrite it from the library and go back to automatic."}
            </p>
            <div className="field-row">
              <button
                type="button"
                className="text-button"
                onClick={() => setShowText((v) => !v)}
              >
                {showText ? "Hide text" : "Show text"}
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => void buildFromReferences()}
              >
                <Sparkles size={13} /> Build from reference photos
              </button>
            </div>
            {showText && (
              <>
                <label className="field-label" htmlFor="skill-description">
                  Description (shown under the picker)
                </label>
                <input
                  id="skill-description"
                  className="text-input"
                  value={form.description}
                  onChange={(e) => set({ description: e.target.value })}
                />
                <label className="field-label" htmlFor="skill-goal">
                  Direction
                </label>
                <textarea
                  id="skill-goal"
                  className="prompt"
                  rows={6}
                  value={form.goal}
                  onChange={(e) => set({ goal: e.target.value })}
                />
                <label className="field-label" htmlFor="skill-library">
                  Library (numbered scene families, poses, light, camera, colour, avoid)
                </label>
                <textarea
                  id="skill-library"
                  className="prompt prompt-tall"
                  rows={14}
                  value={form.library}
                  onChange={(e) => set({ library: e.target.value })}
                />
              </>
            )}
            <p className="prompt-tip">
              Shared rules apply to every skill automatically: the original outfit, footwear and
              accessories stay identical; references give only setting, pose, light and camera
              angle; nothing is copied from a reference's hats, bags or props; one reference is
              picked at random per image; the upload's framing is kept; catalogue-safe wording.
            </p>
          </>
        )}
        <div className="footer-actions">
          {skill && (
            <button className="secondary danger" onClick={() => void remove()} disabled={busy}>
              <Trash2 size={16} />
              {skill.builtIn ? "Hide" : "Delete"}
            </button>
          )}
          {skill?.builtIn && skill.edited && (
            <button className="secondary" onClick={() => void reset()} disabled={busy}>
              <RotateCcw size={16} />
              Reset to original
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button className="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="primary" onClick={() => void save()} disabled={busy || !canSave}>
            {busy ? <LoaderCircle className="spinning" size={16} /> : <Save size={16} />}
            Save
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
