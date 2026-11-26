import { useId } from "react";

type SearchableSelectProps = {
  label: string;
  value: number | "";
  options: Array<{ value: number; label: string }>;
  onChange: (value: number | "") => void;
  placeholder?: string;
  className?: string;
};

export function SearchableSelect({ label, value, options, onChange, placeholder = "Search…", className = "" }: SearchableSelectProps) {
  const listId = useId();
  const selected = options.find((option) => option.value === value);
  return (
    <label className={`block ${className}`}>
      <span className="sr-only">{label}</span>
      <input
        className="input w-full"
        list={listId}
        aria-label={label}
        placeholder={placeholder}
        value={selected?.label ?? ""}
        onChange={(event) => onChange(options.find((option) => option.label === event.target.value)?.value ?? "")}
      />
      <datalist id={listId}>
        {options.map((option) => <option key={option.value} value={option.label} />)}
      </datalist>
    </label>
  );
}
