import { useEffect, useState } from "react";

/** Matches Tailwind's `xl` breakpoint: the purchase editor opens as a right-hand panel from here up, a full-screen sheet below. */
const WIDE_QUERY = "(min-width: 1280px)";

function matches() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(WIDE_QUERY).matches;
}

export function useWideLayout() {
  const [wide, setWide] = useState(matches);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const query = window.matchMedia(WIDE_QUERY);
    const update = () => setWide(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return wide;
}
