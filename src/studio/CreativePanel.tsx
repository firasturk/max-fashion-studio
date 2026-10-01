import {
  Bookmark,
  Check,
  FileImage,
  LoaderCircle,
  Pencil,
  PiggyBank,
  ScanLine,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { del, post } from "@/api";
import { Switch } from "@/components/ui/switch";
import Picker from "./Picker";
import { SKILLS, skillById } from "@shared/skills";
import {
  DEFAULT_PROMPT,
  SCENES,
  INPUT_TYPES,
  MARKETS,
  MAX_COUNT,
  OUTPUT_FORMATS,
  RATIOS,
  SIZES,
  backdropColors,
  type Config,
} from "@shared/config";
import type { EngineModel, Preset } from "@shared/types";

const COUNTS = Array.from({ length: MAX_COUNT }, (_, i) => String(i + 1));

export default function CreativePanel({
  config,
  locked,
  saved,
  models,
  defaultModel,
  onChange,
  editing = false,
  canEdit = false,
  saving = false,
  onEdit,
  onSave,
  onCancel,
  presets = [],
  onPresetsChanged,
}: {
  config: Config;
  locked: boolean;
  saved: boolean;
  models: EngineModel[];
  defaultModel: string;
  onChange: (patch: Partial<Config>) => void;
  editing?: boolean;
  canEdit?: boolean;
  saving?: boolean;
  onEdit?: () => void;
  onSave?: () => void;
  onCancel?: () => void;
  presets?: Preset[];
  onPresetsChanged?: () => Promise<void>;
}) {
  const [presetName, setPresetName] = useState("");
  const [savingPreset, setSavingPreset] = useState(false);

  async function savePreset() {
    if (!presetName.trim()) return;
    setSavingPreset(true);
    try {
      await post("/api/studio/presets", { name: presetName.trim(), config });
      setPresetName("");
      await onPresetsChanged?.();
      toast.success("Template saved.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSavingPreset(false);
    }
  }

  async function removePreset(id: string) {
    try {
      await del(`/api/studio/presets?id=${encodeURIComponent(id)}`);
      await onPresetsChanged?.();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  const enabled = models.filter((m) => m.enabled);
  const modelItems = enabled.length ? enabled.map((m) => m.slug) : [config.model || defaultModel];
  const modelLabel = (slug: string) => models.find((m) => m.slug === slug)?.name ?? slug;
  const realModelOnly = config.mode !== "1" && config.mode !== "6";

  return (
    <aside className="config-panel">
      <div className="panel-heading">
        <span className="step">02</span>
        <h2>Creative direction</h2>
        {canEdit && !editing && (
          <button
            className="icon-button"
            onClick={onEdit}
            aria-label="Edit batch settings"
            title="Edit batch settings"
          >
            <Pencil size={17} />
          </button>
        )}
      </div>
      {saved && !editing && (
        <p className="saved-note">
          Settings saved with this batch.{" "}
          {canEdit
            ? "Use the pencil to edit them for the remaining images."
            : "Pause the batch to edit them."}
        </p>
      )}
      {editing && (
        <div className="edit-bar">
          <span>
            Editing saved settings. Queued images will use them; finished images keep theirs.
          </span>
          <div className="footer-actions">
            <button className="primary" onClick={onSave} disabled={saving}>
              {saving ? <LoaderCircle className="spinning" size={15} /> : <Check size={15} />} Save
            </button>
            <button className="secondary" onClick={onCancel} disabled={saving}>
              <X size={15} /> Cancel
            </button>
          </div>
        </div>
      )}

      {!locked && (
        <div className="presets-box">
          <label className="field-label">Templates</label>
          {presets.length > 0 && (
            <ul>
              {presets.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      const c = JSON.parse(p.config) as Config;
                      onChange({ ...c });
                      toast.success(`Template "${p.name}" applied.`);
                    }}
                  >
                    <Bookmark size={13} /> {p.name}
                  </button>
                  <button
                    type="button"
                    className="icon-button small"
                    aria-label={`Delete ${p.name}`}
                    onClick={() => void removePreset(p.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="footer-actions">
            <input
              className="text-input"
              placeholder="Save current settings as…"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
            />
            <button
              type="button"
              className="secondary"
              onClick={() => void savePreset()}
              disabled={savingPreset || !presetName.trim()}
            >
              {savingPreset ? (
                <LoaderCircle className="spinning" size={15} />
              ) : (
                <Bookmark size={15} />
              )}{" "}
              Save
            </button>
          </div>
        </div>
      )}

      <label className="field-label">AI model</label>
      <Picker
        value={config.model || defaultModel}
        label="AI model"
        disabled={locked}
        items={modelItems}
        render={modelLabel}
        onChange={(v) => onChange({ model: v })}
      />
      {models.some((m) => !m.enabled) && (
        <div className="prompt-tip">
          Not available on your Higgsfield account:{" "}
          {models
            .filter((m) => !m.enabled)
            .map((m) => m.name)
            .join(", ")}
          .
        </div>
      )}

      {(config.model || defaultModel).startsWith("gemini") && (
        <div className="centering">
          <PiggyBank size={21} />
          <div>
            <strong>Economy mode</strong>
            <span>Google Flex tier · half price · delivery can take minutes to hours</span>
          </div>
          <Switch
            checked={config.economy}
            disabled={locked}
            onCheckedChange={(v) => onChange({ economy: v })}
            aria-label="Economy mode"
          />
        </div>
      )}

      <label className="field-label">Original photography</label>
      <Picker
        value={config.input}
        label="Source type"
        disabled={locked || realModelOnly}
        items={realModelOnly ? ["model"] : INPUT_TYPES}
        onChange={(v) => onChange({ input: v as Config["input"] })}
      />

      {config.mode === "6" && (
        <>
          <label className="field-label" htmlFor="colors">
            Background colours (comma-separated, one image each)
          </label>
          <input
            id="colors"
            className="text-input"
            disabled={locked}
            value={config.colors}
            onChange={(e) => onChange({ colors: e.target.value })}
            placeholder="pure white, warm beige, #F2E8DA"
          />
          <div className="prompt-tip">
            {backdropColors(config).length} colour{backdropColors(config).length > 1 ? "s" : ""}:{" "}
            {backdropColors(config).join(" · ")}
          </div>
        </>
      )}

      {config.mode !== "1" && config.mode !== "6" && (
        <>
          <label className="field-label">
            {config.mode === "4"
              ? "Backgrounds per original"
              : config.mode === "3"
                ? "Poses per original"
                : "Images per original"}
          </label>
          <Picker
            value={String(config.count)}
            label="Images per original"
            disabled={locked}
            items={COUNTS}
            onChange={(v) => onChange({ count: Number(v) })}
          />
        </>
      )}

      {config.mode === "5" && (
        <>
          <label className="field-label">Skill</label>
          <div className="skills" role="radiogroup" aria-label="Skill">
            {SKILLS.map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={config.skill === s.id}
                className={`skill-card ${config.skill === s.id ? "active" : ""}`}
                disabled={locked}
                onClick={() => onChange({ skill: s.id })}
              >
                <strong>{s.title}</strong>
                <span>{s.caption}</span>
              </button>
            ))}
          </div>
          <div className="prompt-tip">{skillById(config.skill).description}</div>

          <label className="field-label">Generated face (when the reference face is hidden)</label>
          <Picker
            value={config.market}
            label="Market look"
            disabled={locked}
            items={MARKETS}
            render={(v) =>
              v === "auto"
                ? "Auto (alternate Arab / European)"
                : v === "arab"
                  ? "Arab / Middle-Eastern"
                  : v === "european"
                    ? "European"
                    : "Mixed"
            }
            onChange={(v) => onChange({ market: v as Config["market"] })}
          />
        </>
      )}

      {config.mode === "1" && (
        <>
          <label className="field-label" htmlFor="backdrop">
            Studio backdrop (cards 2-5)
          </label>
          <input
            id="backdrop"
            className="text-input"
            disabled={locked}
            value={config.backdrop}
            onChange={(e) => onChange({ backdrop: e.target.value })}
            placeholder="warm beige seamless paper backdrop"
          />
        </>
      )}

      {(config.mode === "1" || config.mode === "2") && (
        <>
          <label className="field-label" htmlFor="model-direction">
            Model direction
          </label>
          <textarea
            id="model-direction"
            disabled={locked}
            rows={2}
            value={config.modelDescription}
            onChange={(e) => onChange({ modelDescription: e.target.value })}
          />
        </>
      )}

      <div className="field-row">
        <label className="field-label" htmlFor="prompt">
          {config.mode === "4"
            ? "Background direction"
            : config.mode === "6"
              ? "Extra instructions (optional)"
              : config.mode === "5"
                ? "City / mood preference (optional)"
                : "Background & lifestyle prompt"}
        </label>
        <button
          className="text-button"
          disabled={locked}
          onClick={() => onChange({ prompt: DEFAULT_PROMPT })}
        >
          Reset
        </button>
      </div>
      <textarea
        id="prompt"
        className="prompt"
        value={config.prompt}
        disabled={locked}
        onChange={(e) => onChange({ prompt: e.target.value })}
      />
      {config.mode !== "5" && config.mode !== "6" && (
        <div className="prompt-tip">
          Each image also gets one of the built-in scenes: {SCENES.slice(0, 2).join(" ")} …
        </div>
      )}

      <div className="two-fields">
        <div>
          <label className="field-label">Frame</label>
          <Picker
            label="Aspect ratio"
            value={config.ratio}
            disabled={locked}
            items={RATIOS}
            onChange={(v) => onChange({ ratio: v as Config["ratio"] })}
          />
        </div>
        <div>
          <label className="field-label">Resolution</label>
          <Picker
            label="Resolution"
            value={config.size}
            disabled={locked}
            items={SIZES}
            onChange={(v) => onChange({ size: v as Config["size"] })}
          />
        </div>
      </div>

      {config.mode !== "4" && config.mode !== "6" && config.mode !== "5" && (
        <>
          <div className="centering">
            <ScanLine size={21} />
            <div>
              <strong>Centre model</strong>
              <span>Check alignment · retry once if needed</span>
            </div>
            <Switch
              checked={config.center}
              disabled={locked}
              onCheckedChange={(v) => onChange({ center: v })}
              aria-label="Check model centering"
            />
          </div>
          <p className="quality-note">
            Alignment is checked only when automatic review is configured. Uncertain results are
            held for review. Extra attempts use additional credits.
          </p>
        </>
      )}

      <div className="two-fields">
        <div>
          <label className="field-label">Export format</label>
          <Picker
            label="Export format"
            value={config.output}
            disabled={locked}
            items={OUTPUT_FORMATS}
            render={(v) => v.toUpperCase()}
            onChange={(v) => onChange({ output: v as Config["output"] })}
          />
        </div>
        <div>
          <label className="field-label">Quality</label>
          <Picker
            label="Export quality"
            value={String(config.outputQuality)}
            disabled={locked || config.output === "png"}
            items={["100", "95", "90", "85", "80", "75"]}
            render={(v) => `${v}%`}
            onChange={(v) => onChange({ outputQuality: Number(v) })}
          />
        </div>
      </div>

      <div className="export-rule">
        <FileImage size={18} />
        <div>
          Original filename + <b>-AI</b>
          <span>
            Example: MAX_001.jpg → MAX_001-AI.{config.output} (or -AI-01, -AI-02 for sets)
          </span>
        </div>
      </div>
    </aside>
  );
}
