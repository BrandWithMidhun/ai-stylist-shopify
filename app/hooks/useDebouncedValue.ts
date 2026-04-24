// Returns a debounced copy of `value` that updates at most once per `delay`
// milliseconds. Used by the dashboard search field (150ms per decision #9).

import { useEffect, useState } from "react";

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    // eslint-disable-next-line no-undef
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => {
      // eslint-disable-next-line no-undef
      clearTimeout(id);
    };
  }, [value, delayMs]);
  return debounced;
}
