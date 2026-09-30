import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ShieldCheck } from "lucide-react";
import { MODES } from "./constants";

export default function ModeCards({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (mode: "1" | "2" | "3" | "4" | "5") => void;
}) {
  return (
    <>
      <div className="workflow-label">
        <span className="step">01</span>
        <h2>Choose your production approach</h2>
      </div>
      <RadioGroup
        className="modes"
        value={value}
        onValueChange={(v) => onChange(v as "1")}
        disabled={disabled}
      >
        {MODES.map((m) => (
          <label key={m.id} className={`mode-card ${value === m.id ? "active" : ""}`}>
            <div className="mode-top">
              <m.icon size={23} />
              <RadioGroupItem value={m.id} aria-label={m.title} />
            </div>
            <strong>{m.title}</strong>
            <span>{m.caption}</span>
            <div className="mode-number">0{m.id}</div>
          </label>
        ))}
      </RadioGroup>
      <div className="mode-note">
        <ShieldCheck size={16} />
        {MODES.find((m) => m.id === value)?.detail}
      </div>
    </>
  );
}
