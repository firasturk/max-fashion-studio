import { useRef } from "react";
import { FileImage, ScanLine, Settings2, UserRound } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import Picker from "./Picker";
import { CATEGORY_PRESETS, INPUT_TYPES, RATIOS, SIZES, type Config } from "@shared/config";

export default function CreativePanel({
  config,
  locked,
  saved,
  identityName,
  onChange,
  onIdentity,
}: {
  config: Config;
  locked: boolean;
  saved: boolean;
  identityName: string;
  onChange: (patch: Partial<Config>) => void;
  onIdentity: (file: File) => void;
}) {
  const identityInput = useRef<HTMLInputElement>(null);
  return (
    <aside className="config-panel">
      <div className="panel-heading">
        <span className="step">02</span>
        <h2>Creative direction</h2>
        <Settings2 size={18} />
      </div>
      {saved && (
        <p className="saved-note">
          Settings saved with this batch. Use individual revisions to change a result.
        </p>
      )}

      <label className="field-label">Clothing category</label>
      <Picker
        value={config.category}
        label="Clothing category"
        disabled={locked}
        items={Object.keys(CATEGORY_PRESETS)}
        onChange={(v) => onChange({ category: v, prompt: CATEGORY_PRESETS[v] })}
      />

      <label className="field-label">Original photography</label>
      <Picker
        value={config.input}
        label="Source type"
        disabled={locked}
        items={config.mode === "4" ? ["model"] : INPUT_TYPES}
        onChange={(v) => onChange({ input: v as Config["input"] })}
      />

      {config.mode === "3" && (
        <div className="identity">
          <label className="field-label">Real model identity reference</label>
          <input
            ref={identityInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onIdentity(f);
              e.target.value = "";
            }}
          />
          <button
            className="reference-button"
            disabled={locked}
            onClick={() => identityInput.current?.click()}
          >
            <UserRound size={18} />
            {identityName || (config.identity ? "Reference saved" : "Upload model reference")}
          </button>
          <small>Use a clear photo of the consenting adult model.</small>
        </div>
      )}

      {config.mode !== "4" && (
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
          Background &amp; lifestyle prompt
        </label>
        <button
          className="text-button"
          disabled={locked}
          onClick={() => onChange({ prompt: CATEGORY_PRESETS[config.category] })}
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
        Product preservation and framing instructions are added automatically.
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
        A result passes alignment within 1% of frame width when automatic review is configured.
        Uncertain results are held for review. Extra attempts use additional credits.
      </p>

      <div className="export-rule">
        <FileImage size={18} />
        <div>
          Original filename + <b>-AI</b>
          <span>Example: MAX_001.jpg → MAX_001-AI.png</span>
        </div>
      </div>
    </aside>
  );
}
