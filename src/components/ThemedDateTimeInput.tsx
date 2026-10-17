import { forwardRef, useImperativeHandle, useRef } from "react";
import type { InputHTMLAttributes, PointerEvent } from "react";
import { CalendarDays, Clock3 } from "lucide-react";

type ThemedDateTimeInputProps = InputHTMLAttributes<HTMLInputElement>;

export const ThemedDateTimeInput = forwardRef<HTMLInputElement, ThemedDateTimeInputProps>(function ThemedDateTimeInput(
  { type = "date", className = "", disabled, ...props },
  forwardedRef,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement);
  const isTime = type === "time";
  const Icon = isTime ? Clock3 : CalendarDays;

  const openPicker = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const input = inputRef.current;
    if (!input) return;
    if (typeof input.showPicker === "function") {
      try {
        input.showPicker();
        return;
      } catch {
        // Fall through to focus when the browser rejects the picker request.
      }
    }
    input.focus();
  };

  return (
    <span className="themed-date-time-input">
      <input ref={inputRef} {...props} disabled={disabled} type={type} className={`${className} themed-date-time-input-field`} />
      <button type="button" className="themed-date-time-input-trigger" tabIndex={-1} disabled={disabled} aria-label={isTime ? "Open time picker" : "Open date picker"} onPointerDown={openPicker}>
        <Icon aria-hidden="true" className="h-4 w-4" />
      </button>
    </span>
  );
});
