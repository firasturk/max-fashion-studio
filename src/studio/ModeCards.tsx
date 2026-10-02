import { useState } from "react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Eye, EyeOff, Pencil, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { post } from "@/api";
import { MODES, type ModeInfo } from "./constants";
import type { ModeOverride } from "@shared/types";

type ModeId = ModeInfo["id"];

/** Built-in cards with the team's renames applied. */
export function applyModeOverrides(overrides: Record<string, ModeOverride>): ModeInfo[] {
  return MODES.map((m) => ({
    ...m,
    title: overrides[m.id]?.title || m.title,
    caption: overrides[m.id]?.caption || m.caption,
  }));
}

export default function ModeCards({
  value,
  disabled,
  overrides,
  canEdit = false,
  onChange,
  onOverridesChanged,
}: {
  value: string;
  disabled: boolean;
  overrides: Record<string, ModeOverride>;
  /** Admins may rename and hide cards. */
  canEdit?: boolean;
  onChange: (mode: ModeId) => void;
  onOverridesChanged: (modes: Record<string, ModeOverride>) => void;
}) {
  const [showHidden, setShowHidden] = useState(false);
  const modes = applyModeOverrides(overrides);
  const hiddenCount = modes.filter((m) => overrides[m.id]?.hidden).length;
  const shown = modes.filter((m) => showHidden || !overrides[m.id]?.hidden);

  async function save(patch: {
    id: ModeId;
    title?: string;
    caption?: string;
    hidden?: boolean;
    reset?: boolean;
  }) {
    try {
      const r = await post<{ modes: Record<string, ModeOverride> }>("/api/studio/modes", patch);
      onOverridesChanged(r.modes);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  function rename(m: ModeInfo) {
    const original = MODES.find((x) => x.id === m.id)!;
    const title = window.prompt(`Name for approach 0${m.id}:`, m.title);
    if (title === null) return;
    const caption = window.prompt("Short caption under the name:", m.caption);
    if (caption === null) return;
    if (title.trim() === original.title && caption.trim() === original.caption)
      void save({ id: m.id, reset: true });
    else void save({ id: m.id, title: title.trim(), caption: caption.trim() });
  }

  return (
    <>
      <div className="workflow-label">
        <span className="step">01</span>
        <h2>Choose your production approach</h2>
        {hiddenCount > 0 && (
          <button type="button" className="text-button" onClick={() => setShowHidden((v) => !v)}>
            {showHidden ? "Hide hidden" : `Show ${hiddenCount} hidden`}
          </button>
        )}
      </div>
      <RadioGroup
        className="modes"
        value={value}
        onValueChange={(v) => onChange(v as ModeId)}
        disabled={disabled}
      >
        {shown.map((m) => {
          const hidden = !!overrides[m.id]?.hidden;
          return (
            <label
              key={m.id}
              className={`mode-card ${value === m.id ? "active" : ""} ${hidden ? "hidden-card" : ""}`}
            >
              <div className="mode-top">
                <m.icon size={23} />
                <span className="mode-tools">
                  {/* Spans, not buttons: a button inside a label would become the label's control. */}
                  {canEdit && (
                    <>
                      <span
                        role="button"
                        tabIndex={0}
                        className="mode-tool"
                        aria-label="Rename approach"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          rename(m);
                        }}
                        onKeyDown={(e) => e.key === "Enter" && rename(m)}
                      >
                        <Pencil size={13} />
                      </span>
                      <span
                        role="button"
                        tabIndex={0}
                        className="mode-tool"
                        aria-label={hidden ? "Show approach" : "Hide approach"}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          void save({ id: m.id, hidden: !hidden });
                        }}
                        onKeyDown={(e) => e.key === "Enter" && void save({ id: m.id, hidden: !hidden })}
                      >
                        {hidden ? <Eye size={13} /> : <EyeOff size={13} />}
                      </span>
                    </>
                  )}
                  <RadioGroupItem value={m.id} aria-label={m.title} disabled={disabled || hidden} />
                </span>
              </div>
              <strong>{m.title}</strong>
              <span>{m.caption}</span>
              <img
                className="mode-thumb"
                src={`/modes/${m.id}.jpg`}
                alt=""
                loading="lazy"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
              <div className="mode-number">0{m.id}</div>
            </label>
          );
        })}
      </RadioGroup>
      <div className="mode-note">
        <ShieldCheck size={16} />
        {modes.find((m) => m.id === value)?.detail}
      </div>
    </>
  );
}
