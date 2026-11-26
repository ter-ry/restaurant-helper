import { useEffect, useId, useState } from "react";

type SearchableSelectProps = {
  label: string;
  value: number | "";
  options: Array<{ value: number; label: string }>;
  onChange: (value: number | "") => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
};

export function SearchableSelect({ label, value, options, onChange, placeholder = "Search…", className = "", disabled = false }: SearchableSelectProps) {
  const listId = useId();
  const selected = options.find((option) => option.value === value);
  const [searchText, setSearchText] = useState(selected?.label ?? "");
  useEffect(() => setSearchText(selected?.label ?? ""), [selected?.label]);
  return (
    <label className={`block ${className}`}>
      <span className="sr-only">{label}</span>
      <input
        className="input w-full"
        list={listId}
        aria-label={label}
        placeholder={placeholder}
        disabled={disabled}
        value={searchText}
        onChange={(event) => {
          const nextText = event.target.value;
          setSearchText(nextText);
          const exact = options.find((option) => option.label === nextText);
          if (exact) onChange(exact.value);
          else if (nextText === "") onChange("");
        }}
      />
      <datalist id={listId}>
        {options.map((option) => <option key={option.value} value={option.label} />)}
      </datalist>
    </label>
  );
}
