import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function Picker({
  value,
  onChange,
  items,
  label,
  disabled = false,
  className = "picker",
  render = (v) => v,
}: {
  value: string;
  onChange: (v: string) => void;
  items: readonly string[];
  label: string;
  disabled?: boolean;
  className?: string;
  render?: (v: string) => string;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger aria-label={label} className={className}>
        <SelectValue>{render(value)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {items.map((i) => (
          <SelectItem key={i} value={i}>
            {render(i)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
