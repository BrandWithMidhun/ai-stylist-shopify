// Per-product exclude toggle for the intelligence dashboard.
//
// Tracks optimistic state (so the card fades immediately) and pending ids
// (so the button shows a loader). On failure, reverts and surfaces the
// error string — caller decides how to display it.

import { useCallback, useState } from "react";

export type ExcludeState = {
  optimistic: Record<string, boolean>;
  pending: Set<string>;
  lastError: string | null;
};

export function useProductExclude() {
  const [state, setState] = useState<ExcludeState>({
    optimistic: {},
    pending: new Set(),
    lastError: null,
  });

  const toggle = useCallback(
    async (id: string, next: boolean): Promise<boolean> => {
      setState((s) => {
        const pending = new Set(s.pending);
        pending.add(id);
        return {
          optimistic: { ...s.optimistic, [id]: next },
          pending,
          lastError: null,
        };
      });

      try {
        const res = await fetch(`/api/products/${id}/exclude`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ excluded: next }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(body?.error ?? `HTTP ${res.status}`);
        }
        setState((s) => {
          const pending = new Set(s.pending);
          pending.delete(id);
          return { ...s, pending };
        });
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setState((s) => {
          const pending = new Set(s.pending);
          pending.delete(id);
          const optimistic = { ...s.optimistic };
          delete optimistic[id];
          return { optimistic, pending, lastError: message };
        });
        return false;
      }
    },
    [],
  );

  const clearError = useCallback(
    () => setState((s) => ({ ...s, lastError: null })),
    [],
  );

  return { state, toggle, clearError };
}
