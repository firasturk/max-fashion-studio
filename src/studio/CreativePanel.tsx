import { Check, FileImage, LoaderCircle, Pencil, ScanLine, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import Picker from "./Picker";
import {
  CATEGORIES,
  CATEGORY_PRESETS,
  INPUT_TYPES,
  MARKETS,
  MAX_COUNT,
  RATIOS,
  SIZES,
  backdropColors,
  type Config,
} from "@shared/config";
import type { EngineModel } from "@shared/types";

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
}) {
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

      <label className="field-label">Category (maxfashion.com)</label>
      <Picker
        value={config.category}
        label="Category"
        disabled={locked}
        items={CATEGORIES}
        onChange={(v) => onChange({ category: v, prompt: CATEGORY_PRESETS[v].prompt })}
      />

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
          onClick={() => onChange({ prompt: CATEGORY_PRESETS[config.category].prompt })}
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
      <div className="prompt-tip">
        Each image also gets one of the category's scenes:{" "}
        {CATEGORY_PRESETS[config.category].scenes.slice(0, 2).join(" ")} …
      </div>

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

      {config.mode !== "4" && config.mode !== "6" && (
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

      <div className="export-rule">
        <FileImage size={18} />
        <div>
          Original filename + <b>-AI</b>
          <span>Example: MAX_001.jpg → MAX_001-AI.png (or -AI-01, -AI-02 for sets)</span>
        </div>
      </div>
    </aside>
  );
}
